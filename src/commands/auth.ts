import { authStatus, deleteCredentials, login, normalizeScopes } from "@/auth";
import { many, one } from "@/cli";
import { resolveOAuthClient } from "./helpers";
import type { CommandContext } from "./types";

export async function handleAuthCommand(context: Omit<CommandContext, "oauthClient">): Promise<unknown | undefined> {
  const { parsed, subcommand } = context;
  if (subcommand === "login") {
    const client = await resolveOAuthClient(parsed.flags, { required: true });
    const scopes = normalizeScopes(many(parsed.flags, "scope"), ["readonly"]);
    const noOpen = one(parsed.flags, "no-open") !== undefined;
    const token = await login(client, scopes.normalized, {
      openBrowser: !noOpen,
      onAuthorizationUrl(url) {
        process.stdout.write([
          "Authorize gml by opening this URL:",
          "",
          url,
          "",
          noOpen
            ? "Waiting for authorization..."
            : "Opening your browser and waiting for authorization...",
          "",
        ].join("\n"));
      },
      onAuthorizationReceived() {
        process.stdout.write("Authorization received. Exchanging code for tokens...\n");
      },
      onBrowserOpenError(error) {
        const message = error instanceof Error ? error.message : String(error);
        process.stdout.write([
          `Could not open the browser automatically: ${message}`,
          "Open the URL above manually. Waiting for authorization...",
          "",
        ].join("\n"));
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
  if (subcommand === "status") return { ok: true, ...(await authStatus()) };
  if (subcommand === "logout") {
    await deleteCredentials();
    return { ok: true, authorized: false };
  }
  return undefined;
}
