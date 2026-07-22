import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { type OAuthClient, readGoogleClientSecretFile } from "@/auth";
import { guessMimeType, listLabels, listMessages, type AttachmentInput } from "@/gmail";
import { CliError } from "@/utils";
import type { CommandArgument, CommandId, CommandOptions } from "./types";

export function argumentAt(args: CommandArgument[], index: number): string | undefined {
  const value = args[index];
  return typeof value === "string" ? value : undefined;
}

export function variadicArguments(args: CommandArgument[], index = 0): string[] {
  const value = args[index];
  if (Array.isArray(value)) return value;
  return typeof value === "string" ? [value] : [];
}

export async function resolveBody(options: CommandOptions): Promise<{ text?: string; html?: string }> {
  const bodyValue = options.body ?? options.text;
  const bodyFile = options.bodyFile;
  if (bodyValue !== undefined && bodyFile !== undefined) {
    throw new CliError("Use either --body/--text or --body-file, not both.", "args_invalid");
  }
  const content =
    bodyFile !== undefined
      ? bodyFile === "-"
        ? await Bun.stdin.text()
        : await readTextFile(bodyFile, "message body")
      : bodyValue === "-"
        ? await Bun.stdin.text()
        : bodyValue;
  if (content === undefined) {
    throw new CliError("Missing --body, --text, or --body-file.", "body_missing");
  }
  return options.html === true
    ? { html: content, ...(options.text === undefined ? {} : { text: options.text }) }
    : { text: content };
}

export async function resolveOptionalBody(options: CommandOptions): Promise<{ text?: string; html?: string }> {
  if (options.body === undefined && options.text === undefined && options.bodyFile === undefined) return {};
  return resolveBody(options);
}

export async function resolveAttachments(options: CommandOptions): Promise<AttachmentInput[]> {
  return Promise.all(
    (options.attach ?? []).map(async (filePath) => ({
      filename: basename(filePath),
      mimeType: guessMimeType(filePath),
      content: await readBinaryFile(filePath, "attachment"),
    })),
  );
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function resolveLabelOptions(
  options: CommandOptions,
  oauthClient?: OAuthClient,
): Promise<string[] | undefined> {
  const labels = [...(options.labelId ?? []), ...(options.label ?? [])];
  if (labels.length === 0) return undefined;
  return Promise.all(labels.map((label) => resolveLabelId(label, oauthClient)));
}

export async function resolveLabelId(label: string, oauthClient?: OAuthClient): Promise<string> {
  const system = new Set([
    "INBOX",
    "SPAM",
    "TRASH",
    "UNREAD",
    "STARRED",
    "IMPORTANT",
    "SENT",
    "DRAFT",
    "CHAT",
    "CATEGORY_PERSONAL",
    "CATEGORY_SOCIAL",
    "CATEGORY_PROMOTIONS",
    "CATEGORY_UPDATES",
    "CATEGORY_FORUMS",
  ]);
  const upper = label.toUpperCase();
  if (system.has(upper)) return upper;
  const response = (await listLabels(oauthClient)) as {
    labels?: Array<{ id?: string; name?: string }>;
  };
  const match = response.labels?.find(
    (item) => item.id === label || item.name?.toLowerCase() === label.toLowerCase(),
  );
  if (!match?.id) throw new CliError(`Unknown label: ${label}`, "label_unknown");
  return match.id;
}

export async function resolveTargets(
  ids: string[],
  options: CommandOptions,
  oauthClient?: OAuthClient,
): Promise<string[]> {
  const result = [...ids];
  if (options.query !== undefined) {
    if (options.maxResults === undefined && options.all !== true) {
      throw new CliError(
        "Query-based write operations require --max-results <count> or an explicit --all.",
        "bulk_limit_required",
        { query: options.query },
      );
    }
    if (options.maxResults !== undefined && options.all === true) {
      throw new CliError("Use either --max-results or --all, not both.", "args_invalid");
    }
    result.push(...await collectMessageIds(
      (pageToken, pageSize) => listMessages({
        q: options.query,
        pageToken,
        maxResults: pageSize,
        oauthClient,
      }) as Promise<MessageIdPage>,
      options.maxResults,
    ));
  }
  const unique = [...new Set(result)];
  if (unique.length === 0) {
    throw new CliError("No target messages. Pass ids or --query.", "target_missing");
  }
  return unique;
}

export type MessageIdPage = {
  messages?: Array<{ id?: string }>;
  nextPageToken?: string;
};

export async function collectMessageIds(
  fetchPage: (pageToken: string | undefined, pageSize: number) => Promise<MessageIdPage>,
  limit?: number,
): Promise<string[]> {
  const ids: string[] = [];
  const seenIds = new Set<string>();
  const seenPageTokens = new Set<string>();
  let pageToken: string | undefined;

  while (limit === undefined || ids.length < limit) {
    const remaining = limit === undefined ? 500 : limit - ids.length;
    const page = await fetchPage(pageToken, Math.min(500, remaining));
    for (const message of page.messages ?? []) {
      if (message.id === undefined || seenIds.has(message.id)) continue;
      seenIds.add(message.id);
      ids.push(message.id);
      if (limit !== undefined && ids.length >= limit) break;
    }

    const nextPageToken = page.nextPageToken;
    if (!nextPageToken || limit !== undefined && ids.length >= limit) break;
    if (seenPageTokens.has(nextPageToken)) {
      throw new CliError("Gmail returned a repeated page token.", "pagination_loop", {
        pageToken: nextPageToken,
      });
    }
    seenPageTokens.add(nextPageToken);
    pageToken = nextPageToken;
  }

  return ids;
}

export async function labelsForOrganize(
  command: CommandId,
  options: CommandOptions,
  oauthClient?: OAuthClient,
): Promise<{ addLabelIds: string[]; removeLabelIds: string[] }> {
  const presets: Partial<Record<CommandId, { add?: string[]; remove?: string[] }>> = {
    "messages.mark-read": { remove: ["UNREAD"] },
    "messages.mark-unread": { add: ["UNREAD"] },
    "messages.star": { add: ["STARRED"] },
    "messages.unstar": { remove: ["STARRED"] },
    "messages.archive": { remove: ["INBOX"] },
    "messages.unarchive": { add: ["INBOX"] },
    "messages.spam": { add: ["SPAM"], remove: ["INBOX"] },
    "messages.unspam": { add: ["INBOX"], remove: ["SPAM"] },
  };
  const preset = presets[command] ?? {};
  const addLabelIds = [...new Set(await Promise.all(
    [...(preset.add ?? []), ...(options.add ?? [])].map((label) => resolveLabelId(label, oauthClient)),
  ))];
  const removeLabelIds = [...new Set(await Promise.all(
    [...(preset.remove ?? []), ...(options.remove ?? [])].map((label) => resolveLabelId(label, oauthClient)),
  ))];
  if (command === "messages.modify" && addLabelIds.length === 0 && removeLabelIds.length === 0) {
    throw new CliError("Modify requires at least one --add or --remove label.", "label_change_missing");
  }
  if (addLabelIds.length > 100 || removeLabelIds.length > 100) {
    throw new CliError("Gmail allows at most 100 labels to be added or removed per modify request.", "label_limit_exceeded", {
      add: addLabelIds.length,
      remove: removeLabelIds.length,
    });
  }
  return { addLabelIds, removeLabelIds };
}

export async function readJsonInput(options: CommandOptions): Promise<unknown> {
  if (options.body !== undefined && options.bodyFile !== undefined) {
    throw new CliError("Use either --body or --body-file, not both.", "args_invalid");
  }
  const value = options.bodyFile === undefined
    ? options.body
    : await readTextFile(options.bodyFile, "JSON request body");
  if (value === undefined) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    throw new CliError("Request body is not valid JSON.", "json_invalid", {
      source: options.bodyFile === undefined ? "--body" : options.bodyFile,
    });
  }
}

export async function resolveOAuthClient(
  options: CommandOptions,
  required: true,
): Promise<OAuthClient>;
export async function resolveOAuthClient(
  options: CommandOptions,
  required: false,
): Promise<OAuthClient | undefined>;
export async function resolveOAuthClient(
  options: CommandOptions,
  required: boolean,
): Promise<OAuthClient | undefined> {
  const file = options.clientSecretFile ?? process.env.GML_CLIENT_SECRET_FILE;
  const explicitClientId = options.clientId ?? process.env.GML_CLIENT_ID;
  const explicitClientSecret = options.clientSecret ?? process.env.GML_CLIENT_SECRET;

  if (file !== undefined) {
    const fileClient = await readGoogleClientSecretFile(file);
    if (explicitClientId !== undefined && explicitClientId !== fileClient.clientId) {
      throw new CliError("--client-id does not match --client-secret-file client_id.", "client_id_mismatch");
    }
    return {
      clientId: fileClient.clientId,
      clientSecret: explicitClientSecret ?? fileClient.clientSecret,
    };
  }

  if (explicitClientId !== undefined) {
    return {
      clientId: explicitClientId,
      ...(explicitClientSecret === undefined ? {} : { clientSecret: explicitClientSecret }),
    };
  }

  if (explicitClientSecret !== undefined) {
    throw new CliError("GML_CLIENT_SECRET/--client-secret requires GML_CLIENT_ID/--client-id.", "client_id_missing");
  }

  if (required) {
    throw new CliError(
      "Missing OAuth client credentials. Pass --client-secret-file, or set GML_CLIENT_ID and optionally GML_CLIENT_SECRET.",
      "client_credentials_missing",
    );
  }
  return undefined;
}

async function readTextFile(filePath: string, purpose: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    throw new CliError(`Failed to read ${purpose} file.`, "file_read_failed", {
      path: filePath,
      cause: errorMessage(error),
    });
  }
}

async function readBinaryFile(filePath: string, purpose: string): Promise<Buffer> {
  try {
    return await readFile(filePath);
  } catch (error) {
    throw new CliError(`Failed to read ${purpose} file.`, "file_read_failed", {
      path: filePath,
      cause: errorMessage(error),
    });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
