import type { CommandId, CommandInvocation } from "@/commands";
import { errorToJson, writeJson } from "./json";

type JsonRecord = Record<string, unknown>;

type OutputContext = Pick<CommandInvocation, "id" | "options">;

export function writeCommandOutput(value: unknown, context: OutputContext): void {
  if (context.options.json === true) {
    writeJson(value);
    return;
  }
  process.stdout.write(`${formatCommandOutput(value, context.id)}\n`);
}

export function writeCommandError(error: unknown, context?: OutputContext): void {
  const value = errorToJson(error);
  if (context?.options.json === true) {
    process.stderr.write(`${JSON.stringify(value, null, 2)}\n`);
    return;
  }
  const details = asRecord(value.error);
  const code = stringValue(details?.code) || "error";
  const message = stringValue(details?.message) || "Unknown error";
  const suffix = details?.details === undefined ? "" : `\n${formatValue(details.details)}`;
  process.stderr.write(`${code}: ${message}${suffix}\n`);
}

export function formatCommandOutput(value: unknown, command: CommandId): string {
  const root = asRecord(value) ?? {};

  if (command === "auth.login") {
    return [
      "Authorized Gmail access.",
      `Scopes: ${stringArray(root.scopes).join(", ") || "none"}`,
      `Refreshable: ${yesNo(root.refreshable)}`,
      ...(root.expiresAt === undefined ? [] : [`Expires: ${stringValue(root.expiresAt)}`]),
    ].join("\n");
  }
  if (command === "auth.status") {
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
  if (command === "auth.logout") return "Logged out.";

  const data = root.data ?? value;
  if (command === "profile") return formatProfile(data);
  if (command === "labels.list") return formatLabels(data);
  if (command === "labels.create" || command === "labels.rename") return formatLabel(data);
  if (command === "labels.delete") return `Deleted label ${stringValue(root.id)}.`;
  if (command === "messages.list") return formatMessageList(data);
  if (command === "messages.read") return formatRead(root);
  if (command === "threads.list") return formatThreadList(data);
  if (command === "messages.attachments") return formatAttachments(data);
  if (command === "messages.download") return formatDownloads(root.downloaded);
  if (["messages.send", "messages.reply", "messages.forward", "drafts.send"].includes(command)) {
    return formatResource("Message sent.", data);
  }
  if (command === "drafts.create") return formatResource("Draft created.", data);
  if (command === "drafts.list") return formatDraftList(data);
  if (command === "drafts.delete") return `Deleted draft ${stringValue(root.draftId)}.`;
  if (root.dryRun === true) return formatDryRun(root);
  if (command === "messages.trash" || command === "messages.untrash") {
    const count = root[command === "messages.trash" ? "trashed" : "untrashed"];
    return `${stringValue(count)} message(s) ${command === "messages.trash" ? "trashed" : "restored"}.`;
  }
  if (MODIFY_COMMANDS.has(command)) {
    const updated = stringValue(root.updated);
    const batches = stringValue(root.batches);
    return [`${updated || "0"} message(s) updated.`, ...(batches ? [`Batches: ${batches}`] : [])].join("\n");
  }

  return formatValue(data);
}

const MODIFY_COMMANDS = new Set<CommandId>([
  "messages.modify",
  "messages.mark-read",
  "messages.mark-unread",
  "messages.star",
  "messages.unstar",
  "messages.archive",
  "messages.unarchive",
  "messages.spam",
  "messages.unspam",
]);

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
  return labels
    .map((item) => {
      const label = asRecord(item) ?? {};
      return [label.id, label.name, label.type].map(stringValue).filter(Boolean).join("\t");
    })
    .join("\n");
}

function formatLabel(value: unknown): string {
  const label = asRecord(value) ?? {};
  return ["Label saved.", `ID: ${stringValue(label.id)}`, `Name: ${stringValue(label.name)}`].join("\n");
}

function formatMessageList(value: unknown): string {
  const response = asRecord(value) ?? {};
  const messages = arrayValue(response.messages);
  const lines = [`${messages.length} message(s).`];
  const summaries = arrayValue(response.summaries);
  if (summaries.length > 0) {
    lines.push("ID\tTHREAD\tDATE\tFROM\tSUBJECT\tLABELS");
    lines.push(...summaries.flatMap((item) => formatMessageSummary(item)));
  } else {
    lines.push(
      ...messages.map((item) => {
        const message = asRecord(item) ?? {};
        return [message.id, message.threadId].map(stringValue).filter(Boolean).join("\t");
      }),
    );
  }
  if (response.nextPageToken !== undefined) lines.push(`Next page: ${stringValue(response.nextPageToken)}`);
  if (response.resultSizeEstimate !== undefined)
    lines.push(`Estimated total: ${stringValue(response.resultSizeEstimate)}`);
  return lines.join("\n");
}

function formatMessageSummary(value: unknown): string[] {
  const summary = asRecord(value) ?? {};
  const error = asRecord(summary.error);
  if (error !== undefined) {
    return [`${singleLine(summary.id)}\t\t\t\t[${singleLine(error.code)}] ${singleLine(error.message)}\t`];
  }
  return [
    [summary.id, summary.threadId, summary.date, summary.from, summary.subject, arrayValue(summary.labelIds).join(",")]
      .map(singleLine)
      .join("\t"),
    ...(summary.snippet === undefined ? [] : [`  ${singleLine(summary.snippet)}`]),
  ];
}

function formatRead(root: JsonRecord): string {
  if (typeof root.raw === "string") return root.raw;
  const message = asRecord(root.data) ?? {};
  const headers = asRecord(message.headers) ?? {};
  const body = asRecord(message.body) ?? {};
  const content = stringValue(body.text) || stringValue(body.html) || stringValue(message.snippet);
  const lines = [
    `From: ${stringValue(headers.from)}`,
    `To: ${stringValue(headers.to)}`,
    ...(headers.cc ? [`Cc: ${stringValue(headers.cc)}`] : []),
    `Date: ${stringValue(headers.date)}`,
    `Subject: ${stringValue(headers.subject)}`,
    `Message ID: ${stringValue(message.id)}`,
    `Thread ID: ${stringValue(message.threadId)}`,
    "",
    content,
  ];
  if (body.truncated === true) {
    lines.push(
      "",
      `[Body truncated: showing ${content.length} of ${stringValue(body.originalCharacters)} characters. Use --full to read the complete body.]`,
    );
  }
  const attachments = arrayValue(message.attachments);
  if (attachments.length > 0) lines.push("", "Attachments:", formatAttachments(attachments));
  return lines.join("\n");
}

function formatThreadList(value: unknown): string {
  const response = asRecord(value) ?? {};
  const threads = arrayValue(response.threads);
  const lines = [`${threads.length} thread(s).`];
  const summaries = arrayValue(response.summaries);
  if (summaries.length > 0) {
    lines.push("THREAD\tMESSAGES\tLATEST_MESSAGE\tDATE\tFROM\tSUBJECT\tLABELS");
    lines.push(...summaries.flatMap((item) => formatThreadSummary(item)));
  } else {
    lines.push(...threads.map((item) => stringValue(asRecord(item)?.id)).filter(Boolean));
  }
  if (response.nextPageToken !== undefined) lines.push(`Next page: ${stringValue(response.nextPageToken)}`);
  if (response.resultSizeEstimate !== undefined)
    lines.push(`Estimated total: ${stringValue(response.resultSizeEstimate)}`);
  return lines.join("\n");
}

function formatThreadSummary(value: unknown): string[] {
  const summary = asRecord(value) ?? {};
  const error = asRecord(summary.error);
  if (error !== undefined) {
    return [
      `${singleLine(summary.id)}\t${singleLine(summary.messageCount)}\t\t\t\t[${singleLine(error.code)}] ${singleLine(error.message)}\t`,
    ];
  }
  return [
    [
      summary.id,
      summary.messageCount,
      summary.latestMessageId,
      summary.date,
      summary.from,
      summary.subject,
      arrayValue(summary.labelIds).join(","),
    ]
      .map(singleLine)
      .join("\t"),
    ...(summary.snippet === undefined ? [] : [`  ${singleLine(summary.snippet)}`]),
  ];
}

function formatAttachments(value: unknown): string {
  const attachments = arrayValue(value);
  if (attachments.length === 0) return "No attachments.";
  return attachments
    .map((item) => {
      const attachment = asRecord(item) ?? {};
      const size = attachment.size === undefined ? "" : `${stringValue(attachment.size)} bytes`;
      return [attachment.filename, attachment.mimeType, size, attachment.attachmentId]
        .map(stringValue)
        .filter(Boolean)
        .join("\t");
    })
    .join("\n");
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

function formatDryRun(root: JsonRecord): string {
  const ids = stringArray(root.ids);
  return [`Dry run: ${stringValue(root.matched) || ids.length} message(s) matched.`, ...ids].join("\n");
}

function formatDraftList(value: unknown): string {
  const response = asRecord(value) ?? {};
  const drafts = arrayValue(response.drafts);
  const lines = [`${drafts.length} draft(s).`];
  lines.push(
    ...drafts.map((item) => {
      const draft = asRecord(item) ?? {};
      const message = asRecord(draft.message) ?? {};
      return [draft.id, message.id, message.threadId].map(stringValue).filter(Boolean).join("\t");
    }),
  );
  if (response.nextPageToken !== undefined) lines.push(`Next page: ${stringValue(response.nextPageToken)}`);
  if (response.resultSizeEstimate !== undefined)
    lines.push(`Estimated total: ${stringValue(response.resultSizeEstimate)}`);
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
    return value
      .map((item) => {
        if (isScalar(item)) return `${prefix}- ${inlineValue(item)}`;
        return `${prefix}-\n${formatValue(item, indent + 2)}`;
      })
      .join("\n");
  }
  const record = asRecord(value);
  if (record !== undefined) {
    const entries = Object.entries(record);
    if (entries.length === 0) return `${prefix}(empty)`;
    return entries
      .map(([key, item]) => {
        if (isScalar(item) || (Array.isArray(item) && item.every(isScalar))) {
          return `${prefix}${labelFor(key)}: ${inlineValue(item)}`;
        }
        return `${prefix}${labelFor(key)}:\n${formatValue(item, indent + 2)}`;
      })
      .join("\n");
  }
  return `${prefix}${inlineValue(value)}`;
}

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as JsonRecord) : undefined;
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

function singleLine(value: unknown): string {
  return stringValue(value).replace(/\s+/g, " ").trim();
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
