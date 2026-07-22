import { getAccessToken, type OAuthClient } from "@/auth";
import { CliError, fetchText, HttpNetworkError, HttpTimeoutError } from "@/utils";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";
const GMAIL_REQUEST_TIMEOUT_MS = 20_000;

export type QueryValue = string | number | boolean | string[] | undefined;

export type RequestOptions = {
  method: string;
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  acceptedScopes?: string[];
  oauthClient?: OAuthClient;
  timeoutMs?: number;
};

export async function gmailRequest<T = unknown>(options: RequestOptions): Promise<T> {
  let token = await getAccessToken(options.acceptedScopes, options.oauthClient);
  const url = buildUrl(options.path, options.query);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { response, body } = await sendRequest(url, options, token);
    if (response.status === 401 && attempt === 0) {
      token = await getAccessToken(options.acceptedScopes, options.oauthClient, true);
      continue;
    }
    if (!response.ok) throw gmailResponseError(response, body, options.method, url);
    return body as T;
  }

  throw new CliError("Gmail authentication failed after refreshing the access token.", "gmail_unauthorized", {
    status: 401,
    method: options.method,
    path: url.pathname,
    retryable: false,
  });
}

async function sendRequest(
  url: URL,
  options: RequestOptions,
  token: string,
): Promise<{ response: Response; body: unknown }> {
  let response: Response;
  let text: string;
  try {
    ({ response, text } = await fetchText(url, {
      method: options.method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    }, options.timeoutMs ?? GMAIL_REQUEST_TIMEOUT_MS));
  } catch (error) {
    if (error instanceof HttpTimeoutError) {
      throw new CliError(
        "Gmail API request timed out. Check network or proxy access to gmail.googleapis.com.",
        "gmail_request_timeout",
        requestFailureDetails(options.method, url, isSafeMethod(options.method), { timeoutMs: error.timeoutMs }),
      );
    }
    if (error instanceof HttpNetworkError) {
      throw new CliError(
        "Could not connect to the Gmail API. Check network or proxy access to gmail.googleapis.com.",
        "gmail_network_error",
        requestFailureDetails(options.method, url, isSafeMethod(options.method), { cause: error.message }),
      );
    }
    throw error;
  }

  if (!text) return { response, body: {} };
  try {
    return { response, body: JSON.parse(text) };
  } catch {
    if (response.ok) {
      throw new CliError("Gmail API returned a non-JSON success response.", "gmail_protocol_error", {
        status: response.status,
        method: options.method,
        path: url.pathname,
      });
    }
    return { response, body: { text: text.slice(0, 4096) } };
  }
}

function buildUrl(path: string, query?: Record<string, QueryValue>): URL {
  const url = new URL(GMAIL_BASE + normalizePath(path));
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function gmailResponseError(response: Response, body: unknown, method: string, url: URL): CliError {
  const retryable = response.status === 429 || response.status >= 500;
  const code = response.status === 401
    ? "gmail_unauthorized"
    : response.status === 403
      ? "gmail_forbidden"
      : response.status === 404
        ? "gmail_not_found"
        : response.status === 429
          ? "gmail_rate_limited"
          : response.status >= 500
            ? "gmail_server_error"
            : "gmail_request_failed";
  return new CliError("Gmail API request failed.", code, {
    status: response.status,
    method,
    path: url.pathname,
    retryable,
    ...(response.headers.get("retry-after") === null ? {} : { retryAfter: response.headers.get("retry-after") }),
    ...googleErrorDetails(body),
    response: body,
  });
}

function googleErrorDetails(body: unknown): Record<string, unknown> {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return {};
  const error = (body as Record<string, unknown>).error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) return {};
  const object = error as Record<string, unknown>;
  const errors = Array.isArray(object.errors) ? object.errors : [];
  const first = errors[0];
  const reason = typeof first === "object" && first !== null && "reason" in first ? first.reason : undefined;
  return {
    ...(typeof object.status === "string" ? { googleStatus: object.status } : {}),
    ...(typeof object.message === "string" ? { googleMessage: object.message } : {}),
    ...(typeof reason === "string" ? { googleReason: reason } : {}),
  };
}

function requestFailureDetails(
  method: string,
  url: URL,
  retryable: boolean,
  extra: Record<string, unknown>,
): Record<string, unknown> {
  return { method, path: url.pathname, retryable, ...extra };
}

function isSafeMethod(method: string): boolean {
  return method === "GET" || method === "HEAD";
}

function normalizePath(value: string): string {
  if (value.startsWith("https://gmail.googleapis.com/gmail/v1/")) {
    return value.slice("https://gmail.googleapis.com/gmail/v1".length);
  }
  return value.startsWith("/") ? value : `/${value}`;
}
