import { errorToJson, writeJson } from "./json";

type JsonRecord = Record<string, unknown>;

const JSON_COMMANDS = new Set([
  "profile",
  "labels",
  "labels list",
  "label-create",
  "label-delete",
  "label-rename",
  "list",
  "search",
  "messages list",
  "messages get",
  "read",
  "threads",
  "thread",
  "attachments",
  "download",
  "send",
  "reply",
  "forward",
  "draft",
  "drafts",
  "draft-send",
  "draft-delete",
  "modify",
  "trash",
  "untrash",
  "markread",
  "markunread",
  "star",
  "unstar",
  "archive",
  "unarchive",
  "spam",
  "unspam",
  "request",
]);
const ROOT_COMMANDS = new Set(["auth", ...[...JSON_COMMANDS].map((command) => command.split(" ")[0]!)]);

export function writeCommandOutput(value: unknown, argv: string[]): void {
  if (wantsJson(argv)) {
    writeJson(value);
    return;
  }
  process.stdout.write(`${formatCommandOutput(value, argv)}\n`);
}

export function writeCommandError(error: unknown, argv: string[]): void {
  const value = errorToJson(error);
  if (wantsJson(argv)) {
    process.stderr.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  const details = asRecord(value.error);
  const code = stringValue(details?.code) || "error";
  const message = stringValue(details?.message) || "Unknown error";
  const suffix = details?.details === undefined ? "" : `\n${formatValue(details.details)}`;
  process.stderr.write(`${code}: ${message}${suffix}\n`);
}

export function formatCommandOutput(value: unknown, argv: string[]): string {
  const root = asRecord(value) ?? {};
  const command = commandKey(argv);

  if (command === "auth login") {
    return [
      "Authorized Gmail access.",
      `Scopes: ${stringArray(root.scopes).join(", ") || "none"}`,
      `Refreshable: ${yesNo(root.refreshable)}`,
      ...(root.expiresAt === undefined ? [] : [`Expires: ${stringValue(root.expiresAt)}`]),
    ].join("\n");
  }
  if (command === "auth status") {
    return [
      root.authorized === true ? "Authorized." : "Not authorized.",
      `State: ${stringValue(root.state)}`,
      `Refreshable: ${yesNo(root.refreshable)}`,
      ...(root.clientId === undefined ? [] : [`Client: ${stringValue(root.clientId)}`]),
      ...(stringArray(root.scopes).length === 0 ? [] : [`Scopes: ${stringArray(root.scopes).join(", ")}`]),
      ...(root.expiresAt === undefined ? [] : [`Expires: ${stringValue(root.expiresAt)}`]),
      ...(root.credentialsPath === undefined ? [] : [`Credentials: ${stringValue(root.credentialsPath)}`]),
    ].join("\n");
  }
  if (command === "auth logout") return "Logged out.";

  const data = root.data ?? value;
  if (command === "profile") return formatProfile(data);
  if (command === "labels" || command === "labels list") return formatLabels(data);
  if (command === "label-create" || command === "label-rename") return formatLabel(data);
  if (command === "label-delete") return `Deleted label ${stringValue(root.id)}.`;
  if (["list", "search", "messages list"].includes(command)) return formatMessageList(data);
  if (command === "read") return formatRead(root);
  if (command === "threads") return formatThreadList(data);
  if (command === "attachments") return formatAttachments(data);
  if (command === "download") return formatDownloads(root.downloaded);
  if (["send", "reply", "forward", "draft-send"].includes(command)) {
    return formatResource(command === "draft-send" ? "Message sent." : "Message sent.", data);
  }
  if (command === "draft") return formatResource("Draft created.", data);
  if (command === "drafts") return formatDraftList(data);
  if (command === "draft-delete") return `Deleted draft ${stringValue(root.draftId)}.`;
  if (command === "trash" || command === "untrash") {
    const count = root[command === "trash" ? "trashed" : "untrashed"];
    return `${stringValue(count)} message(s) ${command === "trash" ? "trashed" : "restored"}.`;
  }
  if (["modify", "markread", "markunread", "star", "unstar", "archive", "unarchive", "spam", "unspam"].includes(command)) {
    return data === undefined || (asRecord(data) !== undefined && Object.keys(asRecord(data)!).length === 0)
      ? "Messages updated."
      : formatResource("Messages updated.", data);
  }

  return formatValue(data);
}

export function wantsJson(argv: string[]): boolean {
  const optionArgs = argv.slice(0, argv.indexOf("--") === -1 ? argv.length : argv.indexOf("--"));
  return optionArgs.includes("--json") && JSON_COMMANDS.has(commandKey(argv));
}

function commandKey(argv: string[]): string {
  const index = argv.findIndex((arg) => ROOT_COMMANDS.has(arg));
  const first = index === -1 ? "" : argv[index]!;
  const second = argv[index + 1];
  if (["auth", "messages"].includes(first)) return `${first} ${second ?? ""}`.trim();
  if (first === "labels" && second === "list") return "labels list";
  return first;
}

function formatProfile(value: unknown): string {
  const profile = asRecord(value) ?? {};
  return [
    stringValue(profile.emailAddress),
    `Messages: ${stringValue(profile.messagesTotal)}`,
    `Threads: ${stringValue(profile.threadsTotal)}`,
    ...(profile.historyId === undefined ? [] : [`History ID: ${stringValue(profile.historyId)}`]),
  ].join("\n");
}

function formatLabels(value: unknown): string {
  const labels = arrayValue(asRecord(value)?.labels);
  if (labels.length === 0) return "No labels.";
  return labels.map((item) => {
    const label = asRecord(item) ?? {};
    return [label.id, label.name, label.type].map(stringValue).filter(Boolean).join("\t");
  }).join("\n");
}

function formatLabel(value: unknown): string {
  const label = asRecord(value) ?? {};
  return ["Label saved.", `ID: ${stringValue(label.id)}`, `Name: ${stringValue(label.name)}`].join("\n");
}

function formatMessageList(value: unknown): string {
  const response = asRecord(value) ?? {};
  const messages = arrayValue(response.messages);
  const lines = [`${messages.length} message(s).`];
  lines.push(...messages.map((item) => {
    const message = asRecord(item) ?? {};
    return [message.id, message.threadId].map(stringValue).filter(Boolean).join("\t");
  }));
  if (response.nextPageToken !== undefined) lines.push(`Next page: ${stringValue(response.nextPageToken)}`);
  if (response.resultSizeEstimate !== undefined) lines.push(`Estimated total: ${stringValue(response.resultSizeEstimate)}`);
  return lines.join("\n");
}

function formatRead(root: JsonRecord): string {
  if (typeof root.raw === "string") return root.raw;
  const message = asRecord(root.data) ?? {};
  const headers = asRecord(message.headers) ?? {};
  const body = asRecord(message.body) ?? {};
  const lines = [
    `From: ${stringValue(headers.from)}`,
    `To: ${stringValue(headers.to)}`,
    ...(headers.cc ? [`Cc: ${stringValue(headers.cc)}`] : []),
    `Date: ${stringValue(headers.date)}`,
    `Subject: ${stringValue(headers.subject)}`,
    `Message ID: ${stringValue(message.id)}`,
    `Thread ID: ${stringValue(message.threadId)}`,
    "",
    stringValue(body.text) || stringValue(body.html) || stringValue(message.snippet),
  ];
  const attachments = arrayValue(message.attachments);
  if (attachments.length > 0) lines.push("", "Attachments:", formatAttachments(attachments));
  return lines.join("\n");
}

function formatThreadList(value: unknown): string {
  const response = asRecord(value) ?? {};
  const threads = arrayValue(response.threads);
  const lines = [`${threads.length} thread(s).`];
  lines.push(...threads.map((item) => stringValue(asRecord(item)?.id)).filter(Boolean));
  if (response.nextPageToken !== undefined) lines.push(`Next page: ${stringValue(response.nextPageToken)}`);
  return lines.join("\n");
}

function formatAttachments(value: unknown): string {
  const attachments = arrayValue(value);
  if (attachments.length === 0) return "No attachments.";
  return attachments.map((item) => {
    const attachment = asRecord(item) ?? {};
    const size = attachment.size === undefined ? "" : `${stringValue(attachment.size)} bytes`;
    return [attachment.filename, attachment.mimeType, size, attachment.attachmentId]
      .map(stringValue)
      .filter(Boolean)
      .join("\t");
  }).join("\n");
}

function formatDownloads(value: unknown): string {
  const downloads = arrayValue(value);
  if (downloads.length === 0) return "No attachments downloaded.";
  return [
    `${downloads.length} attachment(s) downloaded.`,
    ...downloads.map((item) => {
      const download = asRecord(item) ?? {};
      return [download.file, download.bytes === undefined ? "" : `${stringValue(download.bytes)} bytes`]
        .map(stringValue)
        .filter(Boolean)
        .join("\t");
    }),
  ].join("\n");
}

function formatDraftList(value: unknown): string {
  const response = asRecord(value) ?? {};
  const drafts = arrayValue(response.drafts);
  const lines = [`${drafts.length} draft(s).`];
  lines.push(...drafts.map((item) => {
    const draft = asRecord(item) ?? {};
    const message = asRecord(draft.message) ?? {};
    return [draft.id, message.id, message.threadId].map(stringValue).filter(Boolean).join("\t");
  }));
  if (response.nextPageToken !== undefined) lines.push(`Next page: ${stringValue(response.nextPageToken)}`);
  return lines.join("\n");
}

function formatResource(title: string, value: unknown): string {
  const resource = asRecord(value);
  if (resource === undefined) return `${title}\n${formatValue(value)}`;
  const fields = ["id", "threadId", "labelIds"]
    .filter((key) => resource[key] !== undefined)
    .map((key) => `${labelFor(key)}: ${inlineValue(resource[key])}`);
  return fields.length === 0 ? `${title}\n${formatValue(value)}` : [title, ...fields].join("\n");
}

function formatValue(value: unknown, indent = 0): string {
  const prefix = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${prefix}(none)`;
    return value.map((item) => {
      if (isScalar(item)) return `${prefix}- ${inlineValue(item)}`;
      return `${prefix}-\n${formatValue(item, indent + 2)}`;
    }).join("\n");
  }
  const record = asRecord(value);
  if (record !== undefined) {
    const entries = Object.entries(record);
    if (entries.length === 0) return `${prefix}(empty)`;
    return entries.map(([key, item]) => {
      if (isScalar(item) || (Array.isArray(item) && item.every(isScalar))) {
        return `${prefix}${labelFor(key)}: ${inlineValue(item)}`;
      }
      return `${prefix}${labelFor(key)}:\n${formatValue(item, indent + 2)}`;
    }).join("\n");
  }
  return `${prefix}${inlineValue(value)}`;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(stringValue).join(", ");
  return String(value);
}

function inlineValue(value: unknown): string {
  if (Array.isArray(value)) return value.map(inlineValue).join(", ");
  if (value === undefined) return "";
  if (value === null) return "null";
  return String(value);
}

function isScalar(value: unknown): boolean {
  return value === null || value === undefined || typeof value !== "object";
}

function labelFor(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase());
}

function yesNo(value: unknown): string {
  return value === true ? "yes" : "no";
}
