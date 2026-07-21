import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { type OAuthClient, readGoogleClientSecretFile } from "../auth";
import { CliError, many, one } from "../cli";
import { guessMimeType, listLabels, listMessages, type AttachmentInput } from "../gmail";

export async function resolveBody(
  flags: Record<string, string[]>,
): Promise<{ text?: string; html?: string }> {
  const bodyValue = one(flags, "body") ?? one(flags, "text");
  const bodyFile = one(flags, "body-file");
  if (bodyValue !== undefined && bodyFile !== undefined) {
    throw new CliError("Use either --body/--text or --body-file, not both.", "args_invalid");
  }
  const content =
    bodyFile !== undefined
      ? bodyFile === "-"
        ? await Bun.stdin.text()
        : await readFile(bodyFile, "utf8")
      : bodyValue === "-"
        ? await Bun.stdin.text()
        : bodyValue;
  if (content === undefined) {
    throw new CliError("Missing --body, --text, or --body-file.", "body_missing");
  }
  return one(flags, "html") === undefined
    ? { text: content }
    : { html: content, ...(one(flags, "text") === undefined ? {} : { text: one(flags, "text") }) };
}

export async function resolveOptionalBody(
  flags: Record<string, string[]>,
): Promise<{ text?: string; html?: string }> {
  const bodyValue = one(flags, "body") ?? one(flags, "text");
  const bodyFile = one(flags, "body-file");
  if (bodyValue === undefined && bodyFile === undefined) return {};
  return resolveBody(flags);
}

export async function resolveAttachments(
  flags: Record<string, string[]>,
): Promise<AttachmentInput[]> {
  return Promise.all(
    many(flags, "attach").map(async (filePath) => ({
      filename: basename(filePath),
      mimeType: guessMimeType(filePath),
      content: await readFile(filePath),
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

export async function resolveLabelFlags(
  flags: Record<string, string[]>,
  oauthClient?: OAuthClient,
): Promise<string[] | undefined> {
  const labels = [...many(flags, "label-id"), ...many(flags, "label")];
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
  flags: Record<string, string[]>,
  oauthClient?: OAuthClient,
): Promise<string[]> {
  const result = [...ids];
  const query = one(flags, "query");
  if (query !== undefined) {
    const maxResults = parsePositiveInteger(one(flags, "max-results"), "--max-results");
    result.push(...await collectMessageIds(
      (pageToken, pageSize) => listMessages({
        q: query,
        pageToken,
        maxResults: String(pageSize),
        oauthClient,
      }) as Promise<MessageIdPage>,
      maxResults,
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

function parsePositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^\d+$/.test(value) || Number(value) < 1 || !Number.isSafeInteger(Number(value))) {
    throw new CliError(`${name} must be a positive integer.`, "args_invalid");
  }
  return Number(value);
}

export async function labelsForOrganize(
  command: string,
  flags: Record<string, string[]>,
  oauthClient?: OAuthClient,
): Promise<{ addLabelIds: string[]; removeLabelIds: string[] }> {
  const add = many(flags, "add");
  const remove = many(flags, "remove");
  const presets: Record<string, { add?: string[]; remove?: string[] }> = {
    markread: { remove: ["UNREAD"] },
    markunread: { add: ["UNREAD"] },
    star: { add: ["STARRED"] },
    unstar: { remove: ["STARRED"] },
    archive: { remove: ["INBOX"] },
    unarchive: { add: ["INBOX"] },
    spam: { add: ["SPAM"], remove: ["INBOX"] },
    unspam: { add: ["INBOX"], remove: ["SPAM"] },
  };
  const preset = presets[command] ?? {};
  const addLabelIds = [...new Set(await Promise.all(
    [...(preset.add ?? []), ...add].map((label) => resolveLabelId(label, oauthClient)),
  ))];
  const removeLabelIds = [...new Set(await Promise.all(
    [...(preset.remove ?? []), ...remove].map((label) => resolveLabelId(label, oauthClient)),
  ))];
  if (addLabelIds.length > 100 || removeLabelIds.length > 100) {
    throw new CliError("Gmail allows at most 100 labels to be added or removed per modify request.", "label_limit_exceeded", {
      add: addLabelIds.length,
      remove: removeLabelIds.length,
    });
  }
  return {
    addLabelIds,
    removeLabelIds,
  };
}

export async function resolveOAuthClient(
  flags: Record<string, string[]>,
  options: { required: true },
): Promise<OAuthClient>;
export async function resolveOAuthClient(
  flags: Record<string, string[]>,
  options: { required: false },
): Promise<OAuthClient | undefined>;
export async function resolveOAuthClient(
  flags: Record<string, string[]>,
  options: { required: boolean },
): Promise<OAuthClient | undefined> {
  const file = one(flags, "client-secret-file") ?? process.env.GML_CLIENT_SECRET_FILE;
  const explicitClientId = one(flags, "client-id") ?? process.env.GML_CLIENT_ID;
  const explicitClientSecret = one(flags, "client-secret") ?? process.env.GML_CLIENT_SECRET;

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

  if (options.required) {
    throw new CliError(
      "Missing OAuth client credentials. Pass --client-secret-file, or set GML_CLIENT_ID and optionally GML_CLIENT_SECRET.",
      "client_credentials_missing",
    );
  }
  return undefined;
}
