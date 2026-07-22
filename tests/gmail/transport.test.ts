import { describe, expect, test } from "bun:test";
import { GMAIL_SCOPES } from "@/auth";
import { gmailRequest, profile } from "@/gmail";
import { withGmailSandbox } from "../support";

describe("Gmail API transport", () => {
  test("constructs the correct URL with /gmail/v1/ prefix", async () => {
    let requestedUrl = "";
    await withGmailSandbox({
      scopes: [GMAIL_SCOPES.readonly],
      fetch(input) {
        requestedUrl = input.toString();
        return Response.json({
          emailAddress: "test@example.com",
          messagesTotal: 1,
          threadsTotal: 1,
          historyId: "1",
        });
      },
    }, async () => {
      await profile();
      expect(requestedUrl).toStartWith("https://gmail.googleapis.com/gmail/v1/");
      expect(requestedUrl).toContain("/users/me/profile");
    });
  });

  test("times out stalled requests with retry metadata", async () => {
    await withGmailSandbox({
      scopes: [GMAIL_SCOPES.readonly],
      fetch(_input, init) {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      },
    }, async () => {
      await expect(gmailRequest({
        method: "GET",
        path: "/users/me/profile",
        acceptedScopes: [GMAIL_SCOPES.readonly],
        timeoutMs: 10,
      })).rejects.toMatchObject({
        code: "gmail_request_timeout",
        details: { timeoutMs: 10, retryable: true },
      });
    });
  });

  test("maps rate limits to a stable retryable error", async () => {
    await withGmailSandbox({
      scopes: [GMAIL_SCOPES.readonly],
      fetch() {
        return Response.json({
          error: {
            status: "RESOURCE_EXHAUSTED",
            message: "Rate limit exceeded",
            errors: [{ reason: "rateLimitExceeded" }],
          },
        }, { status: 429, headers: { "Retry-After": "5" } });
      },
    }, async () => {
      await expect(profile()).rejects.toMatchObject({
        code: "gmail_rate_limited",
        details: {
          status: 429,
          retryable: true,
          retryAfter: "5",
          googleReason: "rateLimitExceeded",
        },
      });
    });
  });

  test("refreshes once after a 401 response", async () => {
    const authorizations: string[] = [];
    await withGmailSandbox({
      scopes: [GMAIL_SCOPES.readonly],
      client: { clientId: "test-client", clientSecret: "test-secret" },
      token: {
        accessToken: "old-token",
        refreshToken: "refresh-token",
      },
      fetch(input, init) {
        const url = input.toString();
        if (url === "https://oauth2.googleapis.com/token") {
          return Response.json({ access_token: "new-token", token_type: "Bearer", expires_in: 3600 });
        }
        authorizations.push(new Headers(init?.headers).get("Authorization") ?? "");
        if (authorizations.length === 1) {
          return Response.json({ error: { message: "Expired" } }, { status: 401 });
        }
        return Response.json({
          emailAddress: "agent@example.com",
          messagesTotal: 1,
          threadsTotal: 1,
          historyId: "10",
        });
      },
    }, async () => {
      await expect(profile()).resolves.toMatchObject({ emailAddress: "agent@example.com" });
      expect(authorizations).toEqual(["Bearer old-token", "Bearer new-token"]);
    });
  });
});
