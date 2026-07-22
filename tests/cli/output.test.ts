import { describe, expect, test } from "vitest";
import { formatCommandOutput } from "@/cli";

describe("text output", () => {
  test("formats message lists with ids and pagination", () => {
    expect(
      formatCommandOutput(
        {
          ok: true,
          data: {
            messages: [{ id: "message-1", threadId: "thread-1" }],
            nextPageToken: "next-token",
            resultSizeEstimate: 12,
          },
        },
        "messages.list",
      ),
    ).toBe(
      ["1 message(s).", "ID\tTHREAD", "message-1\tthread-1", "Next page: next-token", "Estimated total: 12"].join("\n"),
    );
  });

  test("formats message summaries for agent scanning", () => {
    expect(
      formatCommandOutput(
        {
          ok: true,
          data: {
            messages: [{ id: "message-1", threadId: "thread-1" }],
            summaries: [
              {
                id: "message-1",
                threadId: "thread-1",
                date: "Tue, 21 Jul 2026 09:00:00 +0000",
                from: "Jane Doe <jane@example.com>",
                subject: "Quarterly\n update",
                snippet: "The latest numbers are ready.\nPlease review.",
                labelIds: ["INBOX", "IMPORTANT"],
              },
            ],
          },
        },
        "messages.list",
      ),
    ).toBe(
      [
        "1 message(s).",
        "ID\tTHREAD\tDATE\tFROM\tSUBJECT\tLABELS",
        "message-1\tthread-1\tTue, 21 Jul 2026 09:00:00 +0000\tJane Doe <jane@example.com>\tQuarterly update\tINBOX,IMPORTANT",
        "  The latest numbers are ready. Please review.",
      ].join("\n"),
    );
  });

  test("formats auth status as text", () => {
    expect(
      formatCommandOutput(
        {
          ok: true,
          authorized: false,
          state: "unauthorized",
          refreshable: false,
          credentialsPath: "/tmp/gml/credentials.json",
        },
        "auth.status",
      ),
    ).toContain("Not authorized.\nState: unauthorized");
  });

  test("distinguishes refreshable and terminal token expiry", () => {
    expect(
      formatCommandOutput(
        { ok: true, authorized: true, state: "refresh_required", refreshable: true },
        "auth.status",
      ).startsWith("Authorized; access token refresh required.\nState: refresh_required"),
    ).toBe(true);
    expect(
      formatCommandOutput(
        { ok: true, authorized: false, state: "expired", refreshable: false },
        "auth.status",
      ).startsWith("Authorization expired.\nState: expired"),
    ).toBe(true);
  });

  test("marks truncated message bodies", () => {
    expect(
      formatCommandOutput(
        {
          ok: true,
          data: {
            id: "message-1",
            threadId: "thread-1",
            headers: { from: "a@example.com", to: "b@example.com", subject: "Long message" },
            body: { text: "Hello", html: "", truncated: true, originalCharacters: 42 },
          },
        },
        "messages.read",
      ),
    ).toContain("[Body truncated: showing 5 of 42 characters. Use --full to read the complete body.]");
  });

  test("formats thread summaries for agent scanning", () => {
    expect(
      formatCommandOutput(
        {
          ok: true,
          data: {
            threads: [{ id: "thread-1" }],
            summaries: [
              {
                id: "thread-1",
                messageCount: 2,
                latestMessageId: "message-2",
                date: "Tue, 21 Jul 2026 09:00:00 +0000",
                from: "Jane Doe <jane@example.com>",
                subject: "Re: Quarterly update",
                snippet: "The latest numbers are ready.",
                labelIds: ["INBOX", "IMPORTANT"],
              },
            ],
          },
        },
        "threads.list",
      ),
    ).toBe(
      [
        "1 thread(s).",
        "THREAD\tMESSAGES\tLATEST_MESSAGE\tDATE\tFROM\tSUBJECT\tLABELS",
        "thread-1\t2\tmessage-2\tTue, 21 Jul 2026 09:00:00 +0000\tJane Doe <jane@example.com>\tRe: Quarterly update\tINBOX,IMPORTANT",
        "  The latest numbers are ready.",
      ].join("\n"),
    );
  });

  test("formats bulk dry runs without claiming messages were updated", () => {
    expect(
      formatCommandOutput(
        {
          ok: true,
          dryRun: true,
          matched: 2,
          ids: ["message-1", "message-2"],
        },
        "messages.archive",
      ),
    ).toBe(["Dry run: 2 message(s) matched.", "message-1", "message-2"].join("\n"));
  });

  test("adds stable headers to tabular collections", () => {
    expect(
      formatCommandOutput(
        { ok: true, data: { labels: [{ id: "INBOX", name: "INBOX", type: "system" }] } },
        "labels.list",
      ),
    ).toBe("ID\tNAME\tTYPE\nINBOX\tINBOX\tsystem");
    expect(formatCommandOutput({ ok: true, data: { threads: [{ id: "thread-1" }] } }, "threads.list")).toBe(
      "1 thread(s).\nTHREAD\nthread-1",
    );
    expect(
      formatCommandOutput(
        {
          ok: true,
          data: { drafts: [{ id: "draft-1", message: { id: "message-1", threadId: "thread-1" } }] },
        },
        "drafts.list",
      ),
    ).toBe("1 draft(s).\nDRAFT\tMESSAGE\tTHREAD\ndraft-1\tmessage-1\tthread-1");
    expect(
      formatCommandOutput(
        {
          ok: true,
          data: [{ filename: "report.pdf", mimeType: "application/pdf", size: 42, attachmentId: "part-1" }],
        },
        "messages.attachments",
      ),
    ).toBe("FILENAME\tMIME_TYPE\tSIZE\tATTACHMENT\nreport.pdf\tapplication/pdf\t42 bytes\tpart-1");
  });
});
