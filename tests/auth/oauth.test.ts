import { describe, expect, test } from "bun:test";
import { GMAIL_SCOPES, login, startCallbackServer } from "@/auth";
import { withMockFetch, withNativeFetch } from "../support";

describe("OAuth callback", () => {
  test("responds once and resolves the authorization code", async () => {
    await withNativeFetch(async (nativeFetch) => {
      const callback = await startCallbackServer();
      try {
        const code = callback.waitForCode("expected-state");
        const url = new URL(callback.redirectUri);
        url.searchParams.set("state", "expected-state");
        url.searchParams.set("code", "authorization-code");

        const response = await nativeFetch(url);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("Authorization received. Return to gml while it completes sign-in.");
        await expect(code).resolves.toBe("authorization-code");
      } finally {
        await callback.close();
      }
    });
  });

  test("times out while exchanging an authorization code for tokens", async () => {
    let authorizationReceived = false;
    await withMockFetch(
      (_input, init) => {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      },
      async (nativeFetch) => {
        const result = login({ clientId: "test-client" }, [GMAIL_SCOPES.readonly], {
          openBrowser: false,
          tokenRequestTimeoutMs: 10,
          async onAuthorizationUrl(authorizationUrl) {
            const url = new URL(authorizationUrl);
            const redirectUri = url.searchParams.get("redirect_uri");
            const state = url.searchParams.get("state");
            if (redirectUri === null || state === null) throw new Error("OAuth URL is missing callback parameters.");
            const callbackUrl = new URL(redirectUri);
            callbackUrl.searchParams.set("state", state);
            callbackUrl.searchParams.set("code", "sensitive-authorization-code");
            await nativeFetch(callbackUrl);
          },
          onAuthorizationReceived() {
            authorizationReceived = true;
          },
        });

        await expect(result).rejects.toMatchObject({
          code: "oauth_token_timeout",
          details: {
            endpoint: "https://oauth2.googleapis.com/token",
            timeoutMs: 10,
          },
        });
        expect(authorizationReceived).toBe(true);
      },
    );
  });
});
