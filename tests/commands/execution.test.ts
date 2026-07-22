import { describe, expect, test } from "vitest";
import { executeCommand } from "@/app";
import { GMAIL_SCOPES } from "@/auth";
import { collectMessageIds } from "@/commands";
import { withGmailSandbox } from "../support";

describe("command execution", () => {
  test("limits normalized message bodies unless --full is set", async () => {
    const messageBody = "Hello world ".repeat(1_100);
    await withGmailSandbox(
      {
        scopes: [GMAIL_SCOPES.readonly],
        fetch() {
          return Response.json({
            id: "message-1",
            threadId: "thread-1",
            payload: {
              mimeType: "text/plain",
              headers: [],
              body: { data: Buffer.from(messageBody).toString("base64url") },
            },
          });
        },
      },
      async () => {
        const limited = await executeCommand(["read", "message-1", "--max-body-chars", "5"]);
        expect(limited).toMatchObject({
          ok: true,
          value: {
            data: {
              body: { text: "Hello", html: "", truncated: true, originalCharacters: messageBody.length },
            },
          },
        });

        const defaultLimited = await executeCommand(["read", "message-1"]);
        expect(defaultLimited).toMatchObject({
          ok: true,
          value: {
            data: {
              body: {
                text: messageBody.slice(0, 12_000),
                html: "",
                truncated: true,
                originalCharacters: messageBody.length,
              },
            },
          },
        });

        const full = await executeCommand(["read", "message-1", "--full"]);
        expect(full).toMatchObject({
          ok: true,
          value: { data: { body: { text: messageBody, html: "" } } },
        });
      },
    );
  });

  test("enriches message lists with metadata summaries", async () => {
    const requestedUrls: string[] = [];
    await withGmailSandbox(
      {
        scopes: [GMAIL_SCOPES.readonly],
        fetch(input) {
          const url = input.toString();
          requestedUrls.push(url);
          if (url.includes("/messages?")) {
            return Response.json({
              messages: [
                { id: "message-1", threadId: "thread-1" },
                { id: "message-2", threadId: "thread-2" },
              ],
              resultSizeEstimate: 2,
            });
          }
          const id = url.includes("message-1") ? "message-1" : "message-2";
          return Response.json({
            id,
            threadId: id.replace("message", "thread"),
            labelIds: ["INBOX"],
            snippet: `Snippet for ${id}`,
            payload: {
              headers: [
                { name: "From", value: `${id}@example.com` },
                { name: "Subject", value: `Subject for ${id}` },
              ],
            },
          });
        },
      },
      async () => {
        const outcome = await executeCommand(["messages", "list", "--summary", "--max-results", "2"]);
        expect(outcome).toMatchObject({
          ok: true,
          invocation: { id: "messages.list", options: { summary: true, maxResults: 2 } },
          value: {
            data: {
              summaries: [
                { id: "message-1", from: "message-1@example.com", subject: "Subject for message-1" },
                { id: "message-2", from: "message-2@example.com", subject: "Subject for message-2" },
              ],
            },
          },
        });
        expect(requestedUrls).toHaveLength(3);
        expect(requestedUrls[0]).toContain("/messages?maxResults=2");
        expect(requestedUrls.slice(1).every((url) => url.includes("format=metadata"))).toBe(true);
      },
    );
  });

  test("enriches thread lists with the latest message metadata", async () => {
    const requestedUrls: string[] = [];
    await withGmailSandbox(
      {
        scopes: [GMAIL_SCOPES.readonly],
        fetch(input) {
          const url = input.toString();
          requestedUrls.push(url);
          if (url.includes("/threads?")) return Response.json({ threads: [{ id: "thread-1" }] });
          return Response.json({
            id: "thread-1",
            messages: [
              { id: "message-1" },
              {
                id: "message-2",
                labelIds: ["INBOX"],
                snippet: "Latest reply",
                payload: {
                  headers: [
                    { name: "From", value: "jane@example.com" },
                    { name: "Subject", value: "Re: Update" },
                  ],
                },
              },
            ],
          });
        },
      },
      async () => {
        const outcome = await executeCommand(["threads", "newer_than:7d", "--max-results", "1", "--summary"]);
        expect(outcome).toMatchObject({
          ok: true,
          value: {
            data: {
              summaries: [
                {
                  id: "thread-1",
                  messageCount: 2,
                  latestMessageId: "message-2",
                  from: "jane@example.com",
                  subject: "Re: Update",
                },
              ],
            },
          },
        });
        expect(requestedUrls).toHaveLength(2);
        expect(requestedUrls[1]).toContain("format=metadata");
      },
    );
  });

  test("requires an explicit limit or --all for query-based writes", async () => {
    const outcome = await executeCommand(["archive", "--query", "is:inbox"]);
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "bulk_limit_required" },
      invocation: { id: "messages.archive" },
    });
  });

  test("rejects modify operations with no label changes", async () => {
    const outcome = await executeCommand(["modify", "message-1"]);
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: "label_change_missing" },
    });
  });

  test("reports malformed request bodies as input errors", async () => {
    const outcome = await executeCommand(["request", "POST", "/users/me/messages", "--body", "{"]);
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error("Expected command execution to fail.");
    expect(outcome.error).toMatchObject({ code: "json_invalid" });
    expect(outcome.invocation?.id).toBe("request");
  });
});

describe("message target pagination", () => {
  test("collects all message ids across pages", async () => {
    const requested: Array<[string | undefined, number]> = [];
    const ids = await collectMessageIds(async (pageToken, pageSize) => {
      requested.push([pageToken, pageSize]);
      if (pageToken === undefined) {
        return { messages: [{ id: "a" }, { id: "b" }], nextPageToken: "page-2" };
      }
      return { messages: [{ id: "b" }, { id: "c" }] };
    });
    expect(ids).toEqual(["a", "b", "c"]);
    expect(requested).toEqual([
      [undefined, 500],
      ["page-2", 500],
    ]);
  });

  test("stops pagination at the requested total limit", async () => {
    const requested: number[] = [];
    const ids = await collectMessageIds(async (_pageToken, pageSize) => {
      requested.push(pageSize);
      return { messages: [{ id: "a" }, { id: "b" }, { id: "c" }], nextPageToken: "unused" };
    }, 2);
    expect(ids).toEqual(["a", "b"]);
    expect(requested).toEqual([2]);
  });
});
