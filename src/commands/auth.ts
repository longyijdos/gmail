import { authStatus, deleteCredentials, login, normalizeScopes } from "../auth";
import { many } from "../cli";
import { resolveOAuthClient } from "./helpers";
import type { CommandContext } from "./types";

export async function handleAuthCommand(context: Omit<CommandContext, "oauthClient">): Promise<unknown | undefined> {
  const { parsed, subcommand } = context;
  if (subcommand === "login") {
    const client = await resolveOAuthClient(parsed.flags, { required: true });
    const scopes = normalizeScopes(many(parsed.flags, "scope"), ["readonly"]);
    const token = await login(client, scopes.normalized);
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
