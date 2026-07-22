import { mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { CliError } from "@/utils";

export const APP_NAME = "gml";
export const CREDENTIALS_FILE_VERSION = 1;

export type OAuthClient = {
  clientId: string;
  clientSecret?: string;
};

export type StoredToken = {
  accessToken: string;
  tokenType: "Bearer";
  refreshToken?: string;
  expiresAt?: number;
  scopes: string[];
};

export type CredentialsFile = {
  version: typeof CREDENTIALS_FILE_VERSION;
  client?: OAuthClient;
  token?: StoredToken;
};

export function configDir(env: NodeJS.ProcessEnv = process.env): string {
  if (env.GML_HOME) return env.GML_HOME;
  const xdg = env.XDG_CONFIG_HOME;
  if (xdg) return path.join(xdg, APP_NAME);
  const home = env.HOME;
  if (!home) throw new CliError("HOME is not set; set GML_HOME explicitly.", "missing_home");
  return path.join(home, ".config", APP_NAME);
}

export function credentialsPath(env?: NodeJS.ProcessEnv): string {
  return path.join(configDir(env), "credentials.json");
}

export async function loadCredentials(env?: NodeJS.ProcessEnv): Promise<CredentialsFile> {
  let raw: string;
  try {
    raw = await readFile(credentialsPath(env), "utf8");
  } catch (error) {
    if (isNotFound(error)) return { version: CREDENTIALS_FILE_VERSION };
    throw new CliError("Failed to read credentials file.", "credentials_read_failed");
  }
  return parseCredentialsFile(JSON.parse(raw));
}

export async function saveCredentials(credentials: {
  client: OAuthClient;
  token: StoredToken;
}, env?: NodeJS.ProcessEnv): Promise<void> {
  await writePrivateJson(credentialsPath(env), {
    version: CREDENTIALS_FILE_VERSION,
    client: credentials.client,
    token: credentials.token,
  });
}

export async function deleteCredentials(env?: NodeJS.ProcessEnv): Promise<void> {
  await rm(credentialsPath(env), { force: true });
}

export async function readGoogleClientSecretFile(filePath: string): Promise<OAuthClient> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    throw new CliError("Failed to read Google OAuth client secret file.", "client_secret_file_read_failed", {
      path: filePath,
    });
  }
  const root = asObject(JSON.parse(raw), "Google OAuth client secret file");
  const client = asObject(root.installed ?? root.web, "Google OAuth client secret payload");
  return {
    clientId: readString(client.client_id, "client_secret.client_id"),
    ...optionalString(client.client_secret, "clientSecret", "client_secret"),
  };
}

async function writePrivateJson(filePath: string, value: unknown): Promise<void> {
  const dir = path.dirname(filePath);
  const tmp = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(tmp, filePath);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw new CliError("Failed to write private config file.", "config_write_failed", {
      path: filePath,
    });
  }
}

function parseCredentialsFile(value: unknown): CredentialsFile {
  const object = asObject(value, "credentials file");
  if (object.version !== CREDENTIALS_FILE_VERSION) {
    throw new CliError("Unsupported credentials file version.", "credentials_version_unsupported");
  }
  return {
    version: CREDENTIALS_FILE_VERSION,
    ...(object.client === undefined ? {} : { client: parseClient(object.client) }),
    ...(object.token === undefined ? {} : { token: parseToken(object.token) }),
  };
}

function parseClient(value: unknown): OAuthClient {
  const client = asObject(value, "client");
  return {
    clientId: readString(client.clientId, "client.clientId"),
    ...optionalString(client.clientSecret, "clientSecret", "client"),
  };
}

function parseToken(value: unknown): StoredToken {
  const token = asObject(value, "token");
  if (token.tokenType !== "Bearer") {
    throw new CliError("token.tokenType must be Bearer.", "token_invalid");
  }
  return {
    accessToken: readString(token.accessToken, "token.accessToken"),
    tokenType: "Bearer",
    ...optionalString(token.refreshToken, "refreshToken", "token"),
    ...optionalNumber(token.expiresAt, "expiresAt", "token"),
    scopes: readStringArray(token.scopes, "token.scopes"),
  };
}

function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CliError(`${name} must be a JSON object.`, "json_invalid");
  }
  return value as Record<string, unknown>;
}

function readString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new CliError(`${name} must be a non-empty string.`, "json_invalid");
  }
  return value;
}

function readStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string" || !item)) {
    throw new CliError(`${name} must be an array of non-empty strings.`, "json_invalid");
  }
  return value.slice();
}

function optionalString<TKey extends string>(
  value: unknown,
  key: TKey,
  parent: string,
): { [K in TKey]?: string } {
  if (value === undefined) return {};
  return { [key]: readString(value, `${parent}.${key}`) } as { [K in TKey]?: string };
}

function optionalNumber<TKey extends string>(
  value: unknown,
  key: TKey,
  parent: string,
): { [K in TKey]?: number } {
  if (value === undefined) return {};
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new CliError(`${parent}.${key} must be a positive number.`, "json_invalid");
  }
  return { [key]: value } as { [K in TKey]?: number };
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}
