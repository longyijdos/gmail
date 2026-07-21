import { describe, expect, test } from "bun:test";
import { expandScopes, GMAIL_SCOPES, normalizeScopes } from "../src/auth";
import { buildProgram, parseArgs } from "../src/cli";
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
    await program.parseAsync(["auth", "login", "--client-id", "test", "--scope", "readonly"], { from: "user" });
    expect(called).toBe(true);
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
