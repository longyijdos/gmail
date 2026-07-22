import { authStatus, deleteCredentials, login, normalizeScopes } from "@/auth";
import { resolveOAuthClient } from "./helpers";
import type { CommandInvocation } from "./types";

export async function handleAuthCommand(invocation: CommandInvocation): Promise<unknown> {
  const { id, options } = invocation;
  if (id === "auth.login") {
    const client = await resolveOAuthClient(options, true);
    const scopes = normalizeScopes(options.scope ?? [], ["readonly"]);
    const noOpen = options.open === false;
    const token = await login(client, scopes.normalized, {
      openBrowser: !noOpen,
      onAuthorizationUrl(url) {
        process.stdout.write(
          [
            "Authorize gml by opening this URL:",
            "",
            url,
            "",
            noOpen ? "Waiting for authorization..." : "Opening your browser and waiting for authorization...",
            "",
          ].join("\n"),
        );
      },
      onAuthorizationReceived() {
        process.stdout.write("Authorization received. Exchanging code for tokens...\n");
      },
      onBrowserOpenError(error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write(
          [
            `Could not open the browser automatically: ${message}`,
            "Open the URL above manually. Waiting for authorization...",
            "",
          ].join("\n"),
        );
      },
    });
    return {
      ok: true,
      authorized: true,
      requestedScopes: scopes.requested,
      normalizedScopes: scopes.normalized,
      removedScopes: scopes.removed,
      scopes: token.scopes,
      refreshable: token.refreshToken !== undefined,
      expiresAt: token.expiresAt === undefined ? undefined : new Date(token.expiresAt).toISOString(),
    };
  }
  if (id === "auth.status") return { ok: true, ...(await authStatus()) };
  await deleteCredentials();
  return { ok: true, authorized: false };
}
