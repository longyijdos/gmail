import { describe, expect, test } from "bun:test";
import { formatCommandOutput } from "@/cli";

describe("text output", () => {
  test("formats message lists with ids and pagination", () => {
    expect(formatCommandOutput({
      ok: true,
      data: {
        messages: [{ id: "message-1", threadId: "thread-1" }],
        nextPageToken: "next-token",
        resultSizeEstimate: 12,
      },
    }, "messages.list")).toBe([
      "1 message(s).",
      "message-1\tthread-1",
      "Next page: next-token",
      "Estimated total: 12",
    ].join("\n"));
  });

  test("formats message summaries for agent scanning", () => {
    expect(formatCommandOutput({
      ok: true,
      data: {
        messages: [{ id: "message-1", threadId: "thread-1" }],
        summaries: [{
          id: "message-1",
          threadId: "thread-1",
          date: "Tue, 21 Jul 2026 09:00:00 +0000",
          from: "Jane Doe <jane@example.com>",
          subject: "Quarterly\n update",
          snippet: "The latest numbers are ready.\nPlease review.",
          labelIds: ["INBOX", "IMPORTANT"],
        }],
      },
    }, "messages.list")).toBe([
      "1 message(s).",
      "ID\tTHREAD\tDATE\tFROM\tSUBJECT\tLABELS",
      "message-1\tthread-1\tTue, 21 Jul 2026 09:00:00 +0000\tJane Doe <jane@example.com>\tQuarterly update\tINBOX,IMPORTANT",
      "  The latest numbers are ready. Please review.",
    ].join("\n"));
  });

  test("formats auth status as text", () => {
    expect(formatCommandOutput({
      ok: true,
      authorized: false,
      state: "unauthorized",
      refreshable: false,
      credentialsPath: "/tmp/gml/credentials.json",
    }, "auth.status")).toContain("Not authorized.\nState: unauthorized");
  });

  test("formats bulk dry runs without claiming messages were updated", () => {
    expect(formatCommandOutput({
      ok: true,
      dryRun: true,
      matched: 2,
      ids: ["message-1", "message-2"],
    }, "messages.archive")).toBe([
      "Dry run: 2 message(s) matched.",
      "message-1",
      "message-2",
    ].join("\n"));
  });
});
