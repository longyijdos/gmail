import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  expandScopes,
  GMAIL_SCOPES,
  hasAcceptedScope,
  normalizeScopes,
  saveCredentials,
  startCallbackServer,
} from "../src/auth";
import { buildProgram, formatCommandOutput, parseArgs, wantsJson } from "../src/cli";
import { buildRaw, encodeMime, modifyMessages, parseAddresses, profile } from "../src/gmail";
import { collectMessageIds } from "../src/commands/helpers";

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

  test("validates Gmail list page sizes", async () => {
    const program = buildProgram(async () => undefined)
      .configureOutput({ writeErr: () => undefined, outputError: () => undefined });
    await expect(program.parseAsync(["messages", "list", "--max-results", "501"], { from: "user" })).rejects.toMatchObject({
      code: "commander.invalidArgument",
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

describe("pagination", () => {
  test("collects all message ids across pages", async () => {
    const requested: Array<[string | undefined, number]> = [];
    const ids = await collectMessageIds(async (pageToken, pageSize) => {
      requested.push([pageToken, pageSize]);
      if (pageToken === undefined) return { messages: [{ id: "a" }, { id: "b" }], nextPageToken: "page-2" };
      return { messages: [{ id: "b" }, { id: "c" }] };
    });
    expect(ids).toEqual(["a", "b", "c"]);
    expect(requested).toEqual([[undefined, 500], ["page-2", 500]]);
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

describe("Gmail API limits", () => {
  test("splits batchModify requests at 1000 message ids", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gml-test-"));
    const previousHome = process.env.GML_HOME;
    const previousFetch = globalThis.fetch;
    const batchSizes: number[] = [];
    try {
      process.env.GML_HOME = directory;
      await saveCredentials({
        client: { clientId: "test-client" },
        token: {
          accessToken: "test-token",
          tokenType: "Bearer",
          expiresAt: Date.now() + 3_600_000,
          scopes: [GMAIL_SCOPES.modify],
        },
      });
      globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = JSON.parse(String(init?.body)) as { ids: string[] };
        batchSizes.push(body.ids.length);
        return new Response(null, { status: 204 });
      }) as unknown as typeof fetch;

      await modifyMessages({ ids: Array.from({ length: 2001 }, (_, index) => `message-${index}`) });
      expect(batchSizes).toEqual([1000, 1000, 1]);
    } finally {
      globalThis.fetch = previousFetch;
      if (previousHome === undefined) delete process.env.GML_HOME;
      else process.env.GML_HOME = previousHome;
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("accepts the compose scope for users.getProfile", async () => {
    const directory = await mkdtemp(join(tmpdir(), "gml-test-"));
    const previousHome = process.env.GML_HOME;
    const previousFetch = globalThis.fetch;
    try {
      process.env.GML_HOME = directory;
      await saveCredentials({
        client: { clientId: "test-client" },
        token: {
          accessToken: "test-token",
          tokenType: "Bearer",
          expiresAt: Date.now() + 3_600_000,
          scopes: [GMAIL_SCOPES.compose],
        },
      });
      globalThis.fetch = (async () => Response.json({
        emailAddress: "agent@example.com",
        messagesTotal: 1,
        threadsTotal: 1,
        historyId: "10",
      })) as unknown as typeof fetch;

      await expect(profile()).resolves.toMatchObject({ emailAddress: "agent@example.com" });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousHome === undefined) delete process.env.GML_HOME;
      else process.env.GML_HOME = previousHome;
      await rm(directory, { recursive: true, force: true });
    }
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

  test("accepts any scope supported by an operation", () => {
    expect(hasAcceptedScope([GMAIL_SCOPES.readonly, GMAIL_SCOPES.compose], [GMAIL_SCOPES.compose])).toBe(true);
    expect(hasAcceptedScope([GMAIL_SCOPES.readonly, GMAIL_SCOPES.metadata], [GMAIL_SCOPES.metadata])).toBe(true);
    expect(hasAcceptedScope([GMAIL_SCOPES.readonly], [GMAIL_SCOPES.metadata])).toBe(false);
  });
});

describe("OAuth callback", () => {
  test("responds once and resolves the authorization code", async () => {
    const callback = await startCallbackServer();
    try {
      const code = callback.waitForCode("expected-state");
      const url = new URL(callback.redirectUri);
      url.searchParams.set("state", "expected-state");
      url.searchParams.set("code", "authorization-code");

      const response = await fetch(url);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe("Authorization complete. You can return to gml.");
      await expect(code).resolves.toBe("authorization-code");
    } finally {
      await callback.close();
    }
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

  test("parses quoted display names containing commas", () => {
    expect(parseAddresses('"Doe, Jane" <jane@example.com>, Bob <bob@example.com>')).toEqual([
      { name: "Doe, Jane", email: "jane@example.com", raw: '"Doe, Jane" <jane@example.com>' },
      { name: "Bob", email: "bob@example.com", raw: '"Bob" <bob@example.com>' },
    ]);
  });

  test("rejects MIME header injection", () => {
    expect(() => buildRaw({
      to: ["a@example.com"],
      subject: "Hello\r\nBcc: attacker@example.com",
      text: "Body",
    })).toThrow("Subject cannot contain line breaks");
    expect(() => buildRaw({
      to: ["a@example.com\r\nBcc: attacker@example.com"],
      subject: "Hello",
      text: "Body",
    })).toThrow("address cannot contain line breaks");
  });

  test("encodes attachment filenames without injecting headers", () => {
    expect(() => buildRaw({
      to: ["a@example.com"],
      subject: "Attachment",
      text: "Body",
      attachments: [{ filename: "report.pdf\r\nX-Test: yes", content: Buffer.from("test") }],
    })).toThrow("attachment filename cannot contain line breaks");
  });
});
