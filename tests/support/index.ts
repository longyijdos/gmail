import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCredentials, type OAuthClient, type StoredToken } from "@/auth";

export type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Response | Promise<Response>;

type GmailSandboxOptions = {
  scopes: string[];
  fetch: FetchHandler;
  client?: OAuthClient;
  token?: Partial<Omit<StoredToken, "scopes" | "tokenType">>;
};

let globalStateTail = Promise.resolve();

export async function withGmailSandbox<T>(
  options: GmailSandboxOptions,
  run: () => T | Promise<T>,
): Promise<T> {
  return await withGlobalState(async () => {
    const directory = await mkdtemp(join(tmpdir(), "gml-test-"));
    const previousHome = process.env.GML_HOME;
    const previousFetch = globalThis.fetch;

    try {
      process.env.GML_HOME = directory;
      await saveCredentials({
        client: options.client ?? { clientId: "test-client" },
        token: {
          accessToken: "test-token",
          tokenType: "Bearer",
          expiresAt: Date.now() + 3_600_000,
          ...options.token,
          scopes: options.scopes,
        },
      });
      globalThis.fetch = options.fetch as typeof fetch;
      return await run();
    } finally {
      globalThis.fetch = previousFetch;
      if (previousHome === undefined) delete process.env.GML_HOME;
      else process.env.GML_HOME = previousHome;
      await rm(directory, { recursive: true, force: true });
    }
  });
}

export async function withMockFetch<T>(
  fetchHandler: FetchHandler,
  run: (nativeFetch: typeof fetch) => T | Promise<T>,
): Promise<T> {
  return await withGlobalState(async () => {
    const nativeFetch = globalThis.fetch;
    try {
      globalThis.fetch = fetchHandler as typeof fetch;
      return await run(nativeFetch);
    } finally {
      globalThis.fetch = nativeFetch;
    }
  });
}

export async function withNativeFetch<T>(
  run: (nativeFetch: typeof fetch) => T | Promise<T>,
): Promise<T> {
  return await withGlobalState(() => run(globalThis.fetch));
}

async function withGlobalState<T>(run: () => T | Promise<T>): Promise<T> {
  const previous = globalStateTail;
  let release: () => void = () => undefined;
  globalStateTail = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}
