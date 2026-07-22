import { createHash, randomBytes } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type OAuthClient,
  type StoredToken,
  credentialsPath,
  deleteCredentials,
  loadCredentials,
  saveCredentials,
} from "./credentials";
import { CliError } from "../cli";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const REFRESH_SKEW_MS = 60_000;
const TOKEN_REQUEST_TIMEOUT_MS = 15_000;

export const GMAIL_SCOPES = {
  full: "https://mail.google.com/",
  readonly: "https://www.googleapis.com/auth/gmail.readonly",
  metadata: "https://www.googleapis.com/auth/gmail.metadata",
  modify: "https://www.googleapis.com/auth/gmail.modify",
  send: "https://www.googleapis.com/auth/gmail.send",
  compose: "https://www.googleapis.com/auth/gmail.compose",
  insert: "https://www.googleapis.com/auth/gmail.insert",
  labels: "https://www.googleapis.com/auth/gmail.labels",
  "settings.basic": "https://www.googleapis.com/auth/gmail.settings.basic",
  "settings.sharing": "https://www.googleapis.com/auth/gmail.settings.sharing",
} as const;

export type NormalizedScopes = {
  requested: string[];
  normalized: string[];
  removed: Array<{
    scope: string;
    reason: string;
  }>;
};

export type LoginOptions = {
  openBrowser?: boolean;
  onAuthorizationUrl?: (url: string) => void | Promise<void>;
  onAuthorizationReceived?: () => void | Promise<void>;
  onBrowserOpenError?: (error: unknown) => void | Promise<void>;
  tokenRequestTimeoutMs?: number;
};

export function expandScopes(values: string[], fallback: string[] = ["readonly"]): string[] {
  const scopes = values.length === 0 ? fallback : values;
  return normalizeScopes(
    scopes.flatMap((value) => value.split(/[,\s]+/)).filter(Boolean),
  ).normalized;
}

export function normalizeScopes(values: string[], fallback: string[] = ["readonly"]): NormalizedScopes {
  const aliases = (values.length === 0 ? fallback : values)
    .flatMap((value) => value.split(/[,\s]+/))
    .filter(Boolean);
  const requested = aliases.map((scope) => {
    if (scope in GMAIL_SCOPES) return GMAIL_SCOPES[scope as keyof typeof GMAIL_SCOPES];
    throw new CliError(`Unknown Gmail scope alias: ${scope}`, "scope_unknown", {
      aliases: Object.keys(GMAIL_SCOPES),
    });
  });
  const requestedSet = new Set(requested);
  const removed: NormalizedScopes["removed"] = [];
  const metadata = GMAIL_SCOPES.metadata;
  const metadataCovered =
    requestedSet.has(GMAIL_SCOPES.full) ||
    requestedSet.has(GMAIL_SCOPES.readonly) ||
    requestedSet.has(GMAIL_SCOPES.modify);

  const ordered = Object.values(GMAIL_SCOPES).filter((scope) => {
    if (!requestedSet.has(scope)) return false;
    if (scope === metadata && metadataCovered) {
      removed.push({
        scope,
        reason:
          "gmail.metadata is redundant with full/readonly/modify and can restrict Gmail query parameters.",
      });
      return false;
    }
    return true;
  });

  return {
    requested: [...new Set(requested)],
    normalized: ordered,
    removed,
  };
}

export async function login(
  client: OAuthClient,
  scopes: string[],
  options: LoginOptions = {},
): Promise<StoredToken> {
  const callback = await startCallbackServer();
  try {
    const pkce = createPkce();
    const state = randomToken();
    const url = new URL(AUTH_ENDPOINT);
    url.searchParams.set("client_id", client.clientId);
    url.searchParams.set("redirect_uri", callback.redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scopes.join(" "));
    url.searchParams.set("state", state);
    url.searchParams.set("code_challenge", pkce.codeChallenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");

    const authorizationUrl = url.toString();
    const wait = callback.waitForCode(state);
    await options.onAuthorizationUrl?.(authorizationUrl);
    if (options.openBrowser !== false) {
      try {
        await openBrowser(authorizationUrl);
      } catch (error) {
        if (options.onBrowserOpenError === undefined) throw error;
        await options.onBrowserOpenError(error);
      }
    }
    const code = await wait;
    await options.onAuthorizationReceived?.();
    const token = await exchangeCode({
      code,
      codeVerifier: pkce.codeVerifier,
      redirectUri: callback.redirectUri,
      client,
      scopes,
      timeoutMs: options.tokenRequestTimeoutMs,
    });
    await saveCredentials({ client, token });
    return token;
  } finally {
    await callback.close().catch(() => undefined);
  }
}

export async function getAccessToken(
  acceptedScopes: string[] = [],
  client?: OAuthClient,
): Promise<string> {
  const credentials = await loadCredentials();
  let token = credentials.token;
  if (token === undefined) {
    throw new CliError("Not authorized. Run `gml auth login` first.", "not_authorized");
  }
  const refreshClient = client ?? credentials.client;
  if (client !== undefined && credentials.client !== undefined && client.clientId !== credentials.client.clientId) {
    await deleteCredentials();
    throw new CliError("Stored token belongs to a different client. Run `gml auth login` again.", "client_changed");
  }
  if (!hasAcceptedScope(acceptedScopes, token.scopes)) {
    throw new CliError("Stored token does not include a Gmail scope accepted by this operation. Re-run `gml auth login` with an accepted scope.", "scope_missing", {
      accepted: acceptedScopes,
    });
  }
  if (isUsable(token)) return token.accessToken;
  if (!token.refreshToken) {
    throw new CliError("Access token expired and no refresh token is available. Run `gml auth login` again.", "refresh_unavailable");
  }
  if (refreshClient === undefined) {
    throw new CliError(
      "Access token expired. Provide OAuth client credentials for refresh via --client-secret-file or GML_CLIENT_ID/GML_CLIENT_SECRET.",
      "client_credentials_required",
    );
  }
  const refreshed = await refreshToken(refreshClient, token);
  await saveCredentials({ client: refreshClient, token: refreshed });
  return refreshed.accessToken;
}

export function hasAcceptedScope(accepted: string[], granted: string[]): boolean {
  return accepted.length === 0 || accepted.some((scope) => isScopeSatisfied(scope, granted));
}

function isScopeSatisfied(required: string, granted: string[]): boolean {
  if (granted.includes(required)) return true;
  if (granted.includes(GMAIL_SCOPES.full)) return true;
  if (
    granted.includes(GMAIL_SCOPES.modify) &&
    ([
      GMAIL_SCOPES.readonly,
      GMAIL_SCOPES.metadata,
      GMAIL_SCOPES.send,
      GMAIL_SCOPES.compose,
      GMAIL_SCOPES.insert,
    ] as string[]).includes(required)
  ) {
    return true;
  }
  if (granted.includes(GMAIL_SCOPES.compose) && required === GMAIL_SCOPES.send) return true;
  return false;
}

export async function authStatus(): Promise<Record<string, unknown>> {
  const credentials = await loadCredentials();
  const token = credentials.token;
  return {
    authorized: token !== undefined,
    clientStored: credentials.client !== undefined,
    state: token === undefined ? "unauthorized" : isUsable(token) ? "authorized" : "expired",
    refreshable: token?.refreshToken !== undefined,
    credentialsPath: credentialsPath(),
    clientId: credentials.client?.clientId,
    scopes: token?.scopes ?? [],
    expiresAt: token?.expiresAt === undefined ? undefined : new Date(token.expiresAt).toISOString(),
  };
}

async function exchangeCode(options: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
  client: OAuthClient;
  scopes: string[];
  timeoutMs?: number;
}): Promise<StoredToken> {
  const params = new URLSearchParams({
    code: options.code,
    client_id: options.client.clientId,
    grant_type: "authorization_code",
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
  });
  if (options.client.clientSecret) params.set("client_secret", options.client.clientSecret);
  return parseTokenResponse(await tokenRequest(params, options.timeoutMs), options.client, options.scopes);
}

async function refreshToken(client: OAuthClient, token: StoredToken): Promise<StoredToken> {
  const params = new URLSearchParams({
    client_id: client.clientId,
    grant_type: "refresh_token",
    refresh_token: token.refreshToken!,
  });
  if (client.clientSecret) params.set("client_secret", client.clientSecret);
  const refreshed = await parseTokenResponse(await tokenRequest(params), client, token.scopes);
  return {
    ...refreshed,
    refreshToken: refreshed.refreshToken ?? token.refreshToken,
    scopes: refreshed.scopes.length === 0 ? token.scopes : refreshed.scopes,
  };
}

async function tokenRequest(params: URLSearchParams, timeoutMs = TOKEN_REQUEST_TIMEOUT_MS): Promise<unknown> {
  const controller = new AbortController();
  const effectiveTimeoutMs = Math.max(1, timeoutMs);
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  let response: Response;
  let text: string;
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
      redirect: "error",
      signal: controller.signal,
    });
    text = await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new CliError(
        "Timed out connecting to the Google OAuth token endpoint. Check network or proxy access to oauth2.googleapis.com, then run `gml auth login` again.",
        "oauth_token_timeout",
        { endpoint: TOKEN_ENDPOINT, timeoutMs: effectiveTimeoutMs },
      );
    }
    throw new CliError(
      "Could not connect to the Google OAuth token endpoint. Check network or proxy access to oauth2.googleapis.com.",
      "oauth_token_network_error",
      { endpoint: TOKEN_ENDPOINT, cause: errorMessage(error) },
    );
  } finally {
    clearTimeout(timer);
  }
  let body: unknown = {};
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      throw new CliError("OAuth token endpoint returned a non-JSON response.", "oauth_protocol_error", {
        status: response.status,
        endpoint: TOKEN_ENDPOINT,
      });
    }
  }
  if (!response.ok) {
    throw new CliError("OAuth token endpoint rejected the request.", "oauth_token_failed", {
      status: response.status,
      response: sanitizeOAuthError(body),
    });
  }
  return body;
}

function parseTokenResponse(value: unknown, client: OAuthClient, fallbackScopes: string[]): StoredToken {
  if (typeof value !== "object" || value === null) {
    throw new CliError("OAuth token response was not a JSON object.", "oauth_protocol_error");
  }
  const object = value as Record<string, unknown>;
  if (typeof object.access_token !== "string" || object.access_token.length === 0) {
    throw new CliError("OAuth token response did not include access_token.", "oauth_protocol_error");
  }
  const tokenType = typeof object.token_type === "string" ? object.token_type.toLowerCase() : "";
  if (tokenType !== "bearer") {
    throw new CliError("OAuth token response did not use Bearer token type.", "oauth_protocol_error");
  }
  const expiresIn = typeof object.expires_in === "number" && Number.isFinite(object.expires_in)
    ? Math.max(0, object.expires_in)
    : undefined;
  const scope = typeof object.scope === "string" ? object.scope.split(/\s+/).filter(Boolean) : fallbackScopes;
  return {
    accessToken: object.access_token,
    tokenType: "Bearer",
    ...(typeof object.refresh_token === "string" && object.refresh_token ? { refreshToken: object.refresh_token } : {}),
    ...(expiresIn === undefined ? {} : { expiresAt: Date.now() + expiresIn * 1000 }),
    scopes: scope,
  };
}

function isUsable(token: StoredToken): boolean {
  return token.expiresAt === undefined || token.expiresAt - REFRESH_SKEW_MS > Date.now();
}

export type CallbackServer = {
  redirectUri: string;
  waitForCode(state: string): Promise<string>;
  close(): Promise<void>;
};

export async function startCallbackServer(): Promise<CallbackServer> {
  const server = createServer();
  let pending: ((url: URL, response: ServerResponse) => void) | undefined;
  server.on("request", (request, response) => {
    if (pending === undefined) {
      respond(response, 409, "No OAuth login is pending.");
      return;
    }
    pending(new URL(request.url ?? "/", "http://127.0.0.1"), response);
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  if (typeof address !== "object" || address === null) {
    throw new CliError("OAuth callback server did not bind a local TCP port.", "oauth_callback_failed");
  }
  const redirectUri = `http://127.0.0.1:${(address as AddressInfo).port}/oauth/callback`;
  return {
    redirectUri,
    waitForCode(expectedState: string) {
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending = undefined;
          reject(new CliError("OAuth login timed out waiting for browser callback.", "oauth_callback_timeout"));
        }, 5 * 60 * 1000);
        pending = (url, response) => {
          if (url.pathname !== "/oauth/callback") {
            respond(response, 404, "OAuth callback not found.");
            return;
          }
          if (url.searchParams.get("state") !== expectedState) {
            respond(response, 400, "OAuth state mismatch.");
            clearTimeout(timer);
            pending = undefined;
            reject(new CliError("OAuth callback state mismatch.", "oauth_state_mismatch"));
            return;
          }
          const error = url.searchParams.get("error");
          if (error) {
            respond(response, 400, "OAuth authorization failed.");
            clearTimeout(timer);
            pending = undefined;
            reject(new CliError("OAuth authorization failed.", "oauth_authorization_failed", { oauthError: error }));
            return;
          }
          const code = url.searchParams.get("code");
          if (!code) {
            respond(response, 400, "OAuth callback did not include a code.");
            clearTimeout(timer);
            pending = undefined;
            reject(new CliError("OAuth callback did not include a code.", "oauth_code_missing"));
            return;
          }
          respond(response, 200, "Authorization received. Return to gml while it completes sign-in.");
          clearTimeout(timer);
          pending = undefined;
          resolve(code);
        };
      });
    },
    close() {
      return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    },
  };
}

function respond(response: ServerResponse, status: number, message: string): void {
  response.writeHead(status, {
    "Cache-Control": "no-store",
    Connection: "close",
    "Content-Security-Policy": "default-src 'none'",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function openBrowser(url: string): Promise<void> {
  const command = process.platform === "darwin" ? ["open", url] : process.platform === "linux" ? ["xdg-open", url] : undefined;
  if (command === undefined) {
    throw new CliError(`Opening a browser is not supported on ${process.platform}.`, "browser_unsupported");
  }
  const child = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const exitCode = await child.exited;
  if (exitCode !== 0) throw new CliError("Failed to open browser for OAuth login.", "browser_open_failed", { exitCode });
}

function createPkce(): { codeVerifier: string; codeChallenge: string } {
  const codeVerifier = randomToken();
  const codeChallenge = Buffer.from(createHash("sha256").update(codeVerifier).digest()).toString("base64url");
  return { codeVerifier, codeChallenge };
}

function randomToken(): string {
  return Buffer.from(randomBytes(32)).toString("base64url");
}

function sanitizeOAuthError(value: unknown): unknown {
  if (typeof value !== "object" || value === null) return value;
  const object = value as Record<string, unknown>;
  return {
    ...(typeof object.error === "string" ? { error: object.error } : {}),
    ...(typeof object.error_description === "string" ? { error_description: object.error_description } : {}),
  };
}
