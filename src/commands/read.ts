import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { bool, CliError, many, one } from "../cli";
import {
  base64urlDecode,
  extractBody,
  getAttachment,
  getMessage,
  getThread,
  header,
  listAttachments,
  listMessages,
  listThreads,
  profile,
} from "../gmail";
import { resolveLabelFlags } from "./helpers";
import type { CommandContext } from "./types";

export async function handleReadCommand(context: CommandContext): Promise<unknown | undefined> {
  const { parsed, command, subcommand, rest, oauthClient } = context;
  if (command === "profile") return { ok: true, data: await profile(oauthClient) };
  if ((command === "messages" && subcommand === "list") || command === "list" || command === "search") {
    const query = command === "search"
      ? rest.join(" ") || one(parsed.flags, "q")
      : command === "list"
        ? [subcommand, ...rest].filter(Boolean).join(" ") || one(parsed.flags, "q")
        : one(parsed.flags, "q");
    return {
      ok: true,
      data: await listMessages({
        q: query,
        maxResults: one(parsed.flags, "max-results"),
        pageToken: one(parsed.flags, "page-token"),
        labelIds: await resolveLabelFlags(parsed.flags, oauthClient),
        includeSpamTrash: bool(parsed.flags, "include-spam-trash"),
        oauthClient,
      }),
    };
  }
  if ((command === "messages" && subcommand === "get") || command === "read") {
    return readMessage(context);
  }
  if (command === "threads") {
    const q = [subcommand, ...rest].filter(Boolean).join(" ") || one(parsed.flags, "q");
    return {
      ok: true,
      data: await listThreads({
        q,
        maxResults: one(parsed.flags, "max-results"),
        pageToken: one(parsed.flags, "page-token"),
        labelIds: await resolveLabelFlags(parsed.flags, oauthClient),
        includeSpamTrash: bool(parsed.flags, "include-spam-trash"),
        oauthClient,
      }),
    };
  }
  if (command === "thread") {
    const id = subcommand ?? one(parsed.flags, "id");
    if (!id) throw new CliError("Missing thread id.", "thread_id_missing");
    return {
      ok: true,
      data: await getThread({
        id,
        format: one(parsed.flags, "format") ?? "full",
        metadataHeaders: many(parsed.flags, "metadata-header"),
        oauthClient,
      }),
    };
  }
  if (command === "attachments") {
    const id = subcommand ?? one(parsed.flags, "id");
    if (!id) throw new CliError("Missing message id.", "message_id_missing");
    const message = await getMessage({ id, format: "full", oauthClient }) as Record<string, unknown>;
    return { ok: true, data: listAttachments(message.payload) };
  }
  if (command === "download") return downloadAttachments(context);
  return undefined;
}

async function readMessage(context: CommandContext): Promise<unknown> {
  const { parsed, command, subcommand, rest, oauthClient } = context;
  const id = (command === "read" ? subcommand : rest[0]) ?? one(parsed.flags, "id");
  if (!id) throw new CliError("Missing message id.", "message_id_missing");
  if (command === "read") {
    const raw = one(parsed.flags, "raw");
    const message = await getMessage({
      id,
      format: raw === undefined ? "full" : "raw",
      oauthClient,
    }) as Record<string, unknown>;
    if (raw !== undefined) {
      if (typeof message.raw !== "string") {
        throw new CliError("Raw message response did not include raw data.", "raw_message_missing");
      }
      return { ok: true, raw: base64urlDecode(message.raw).toString("utf8") };
    }
    const payload = message.payload;
    const body = extractBody(payload);
    return {
      ok: true,
      data: {
        id: message.id,
        threadId: message.threadId,
        labelIds: message.labelIds,
        snippet: message.snippet,
        headers: {
          date: header(payload, "Date"),
          from: header(payload, "From"),
          to: header(payload, "To"),
          cc: header(payload, "Cc"),
          subject: header(payload, "Subject"),
          messageId: header(payload, "Message-ID"),
          references: header(payload, "References"),
        },
        body,
        attachments: listAttachments(payload),
      },
    };
  }
  return {
    ok: true,
    data: await getMessage({
      id,
      format: one(parsed.flags, "format"),
      metadataHeaders: many(parsed.flags, "metadata-header"),
      oauthClient,
    }),
  };
}

async function downloadAttachments(context: CommandContext): Promise<unknown> {
  const { parsed, subcommand, oauthClient } = context;
  const id = subcommand ?? one(parsed.flags, "id");
  if (!id) throw new CliError("Missing message id.", "message_id_missing");
  const outDir = one(parsed.flags, "out") ?? ".";
  const only = one(parsed.flags, "attachment");
  const message = await getMessage({ id, format: "full", oauthClient }) as Record<string, unknown>;
  const attachments = listAttachments(message.payload).filter((attachment) => only === undefined || attachment.attachmentId === only);
  if (attachments.length === 0) throw new CliError("No matching attachments.", "attachments_not_found");
  await mkdir(outDir, { recursive: true });
  const saved = [];
  for (const attachment of attachments) {
    const data = await getAttachment({ messageId: id, attachmentId: attachment.attachmentId, oauthClient }) as Record<string, unknown>;
    if (typeof data.data !== "string") throw new CliError("Attachment response did not include data.", "attachment_data_missing");
    const file = join(outDir, basename(attachment.filename));
    await writeFile(file, base64urlDecode(data.data));
    saved.push({ file, bytes: attachment.size, attachmentId: attachment.attachmentId });
  }
  return { ok: true, downloaded: saved };
}
