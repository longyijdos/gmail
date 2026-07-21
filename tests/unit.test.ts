import { describe, expect, test } from "bun:test";
import { expandScopes, GMAIL_SCOPES, normalizeScopes } from "../src/auth";
import { buildProgram, formatCommandOutput, parseArgs, wantsJson } from "../src/cli";
import { encodeMime } from "../src/gmail";

describe("args", () => {
  test("parses repeated flags and positionals", () => {
    expect(parseArgs(["messages", "list", "--label-id", "INBOX", "--label-id=SENT"])).toEqual({
      positionals: ["messages", "list"],
      flags: { "label-id": ["INBOX", "SENT"] },
    });
  });

  test("commander rejects unknown options", async () => {
    const program = buildProgram(async () => undefined)
      .configureOutput({ writeErr: () => undefined, outputError: () => undefined });
    await expect(program.parseAsync(["list", "--max-result", "10"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownOption",
    });
  });

  test("commander accepts global OAuth options after nested commands", async () => {
    let called = false;
    const program = buildProgram(async () => {
      called = true;
    });
    await program.parseAsync(["auth", "login", "--no-open", "--client-id", "test", "--scope", "readonly"], { from: "user" });
    expect(called).toBe(true);
  });

  test("JSON output is available for Gmail commands only", async () => {
    let called = false;
    const gmailProgram = buildProgram(async () => {
      called = true;
    });
    await gmailProgram.parseAsync(["profile", "--json"], { from: "user" });
    expect(called).toBe(true);

    const authProgram = buildProgram(async () => undefined)
      .configureOutput({ writeErr: () => undefined, outputError: () => undefined });
    await expect(authProgram.parseAsync(["auth", "status", "--json"], { from: "user" })).rejects.toMatchObject({
      code: "commander.unknownOption",
    });
  });
});

describe("text output", () => {
  test("formats message lists with ids and pagination", () => {
    expect(formatCommandOutput({
      ok: true,
      data: {
        messages: [{ id: "message-1", threadId: "thread-1" }],
        nextPageToken: "next-token",
        resultSizeEstimate: 12,
      },
    }, ["messages", "list"])).toBe([
      "1 message(s).",
      "message-1\tthread-1",
      "Next page: next-token",
      "Estimated total: 12",
    ].join("\n"));
  });

  test("formats auth status as text", () => {
    expect(formatCommandOutput({
      ok: true,
      authorized: false,
      state: "unauthorized",
      refreshable: false,
      credentialsPath: "/tmp/gml/credentials.json",
    }, ["auth", "status"])).toContain("Not authorized.\nState: unauthorized");
  });

  test("does not enable JSON mode for auth commands", () => {
    expect(wantsJson(["auth", "status", "--json"])).toBe(false);
    expect(wantsJson(["profile", "--json"])).toBe(true);
  });
});

describe("scopes", () => {
  test("expands aliases and deduplicates", () => {
    expect(expandScopes(["readonly,send", "send"])).toEqual([
      GMAIL_SCOPES.readonly,
      GMAIL_SCOPES.send,
    ]);
  });

  test("rejects arbitrary scope URIs", () => {
    expect(() => expandScopes(["https://www.googleapis.com/auth/drive.readonly"])).toThrow(
      "Unknown Gmail scope alias",
    );
  });

  test("supports the full Gmail scope alias", () => {
    expect(expandScopes(["full"])).toEqual(["https://mail.google.com/"]);
  });

  test("removes metadata when a broader read scope is present", () => {
    expect(normalizeScopes(["metadata,readonly,send"])).toEqual({
      requested: [GMAIL_SCOPES.metadata, GMAIL_SCOPES.readonly, GMAIL_SCOPES.send],
      normalized: [GMAIL_SCOPES.readonly, GMAIL_SCOPES.send],
      removed: [
        {
          scope: GMAIL_SCOPES.metadata,
          reason:
            "gmail.metadata is redundant with full/readonly/modify and can restrict Gmail query parameters.",
        },
      ],
    });
  });

  test("keeps standalone metadata", () => {
    expect(normalizeScopes(["metadata"])).toEqual({
      requested: [GMAIL_SCOPES.metadata],
      normalized: [GMAIL_SCOPES.metadata],
      removed: [],
    });
  });
});

describe("mime", () => {
  test("encodes a sendable raw message", () => {
    const raw = encodeMime({ to: ["a@example.com"], subject: "Hi", text: "Body" });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: a@example.com");
    expect(decoded).toContain("Subject: Hi");
    expect(decoded).toContain("Content-Transfer-Encoding: base64");
    expect(decoded).toContain(Buffer.from("Body").toString("base64"));
  });
});
