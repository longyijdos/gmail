import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import {
  base64urlDecode,
  extractBody,
  getAttachment,
  getMessage,
  getThread,
  header,
  htmlToText,
  listAttachments,
  listMessages,
  listThreads,
  profile,
  summarizeMessages,
} from "@/gmail";
import { CliError } from "@/utils";
import { argumentAt, resolveLabelOptions, variadicArguments } from "./helpers";
import type { CommandContext } from "./types";

const DEFAULT_READ_BODY_CHARS = 12_000;

export async function handleReadCommand(context: CommandContext): Promise<unknown> {
  const { id, args, options, oauthClient } = context;
  if (id === "profile") return { ok: true, data: await profile(oauthClient) };
  if (id === "messages.list") {
    const q = variadicArguments(args).join(" ") || options.q;
    const response = await listMessages({
      q,
      maxResults: options.maxResults,
      pageToken: options.pageToken,
      labelIds: await resolveLabelOptions(options, oauthClient),
      includeSpamTrash: options.includeSpamTrash,
      oauthClient,
    });
    return {
      ok: true,
      data: options.summary === true ? await summarizeMessages(response, oauthClient) : response,
    };
  }
  if (id === "messages.get") {
    const messageId = argumentAt(args, 0) ?? options.id;
    if (!messageId) throw new CliError("Missing message id.", "message_id_missing");
    return {
      ok: true,
      data: await getMessage({
        id: messageId,
        format: options.format,
        metadataHeaders: options.metadataHeader,
        oauthClient,
      }),
    };
  }
  if (id === "messages.read") return readMessage(context);
  if (id === "threads.list") {
    const q = variadicArguments(args).join(" ") || options.q;
    return {
      ok: true,
      data: await listThreads({
        q,
        maxResults: options.maxResults,
        pageToken: options.pageToken,
        labelIds: await resolveLabelOptions(options, oauthClient),
        includeSpamTrash: options.includeSpamTrash,
        oauthClient,
      }),
    };
  }
  if (id === "threads.get") {
    const threadId = argumentAt(args, 0) ?? options.id;
    if (!threadId) throw new CliError("Missing thread id.", "thread_id_missing");
    return {
      ok: true,
      data: await getThread({
        id: threadId,
        format: options.format ?? "full",
        metadataHeaders: options.metadataHeader,
        oauthClient,
      }),
    };
  }
  if (id === "messages.attachments") {
    const messageId = argumentAt(args, 0) ?? options.id;
    if (!messageId) throw new CliError("Missing message id.", "message_id_missing");
    const message = await getMessage({ id: messageId, format: "full", oauthClient });
    return { ok: true, data: listAttachments(message.payload) };
  }
  return downloadAttachments(context);
}

async function readMessage(context: CommandContext): Promise<unknown> {
  const { args, options, oauthClient } = context;
  const messageId = argumentAt(args, 0) ?? options.id;
  if (!messageId) throw new CliError("Missing message id.", "message_id_missing");
  const message = await getMessage({
    id: messageId,
    format: options.raw === true ? "raw" : "full",
    oauthClient,
  });
  if (options.raw === true) {
    if (typeof message.raw !== "string") {
      throw new CliError("Raw message response did not include raw data.", "raw_message_missing");
    }
    return { ok: true, raw: base64urlDecode(message.raw).toString("utf8") };
  }
  const payload = message.payload;
  const body = extractBody(payload);
  if (!body.text && body.html) body.text = htmlToText(body.html);
  const normalizedBody =
    options.full === true ? body : limitReadBody(body, options.maxBodyChars ?? DEFAULT_READ_BODY_CHARS);
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
      body: normalizedBody,
      attachments: listAttachments(payload),
    },
  };
}

function limitReadBody(
  body: { text: string; html: string },
  limit: number,
): { text: string; html: string; truncated?: true; originalCharacters?: number } {
  const useText = body.text.length > 0;
  const content = useText ? body.text : body.html;
  if (content.length <= limit) return { text: useText ? content : "", html: useText ? "" : content };
  const truncated = sliceWithoutSplittingSurrogate(content, limit);
  return {
    text: useText ? truncated : "",
    html: useText ? "" : truncated,
    truncated: true,
    originalCharacters: content.length,
  };
}

function sliceWithoutSplittingSurrogate(value: string, limit: number): string {
  let end = limit;
  const finalCodeUnit = value.charCodeAt(end - 1);
  const nextCodeUnit = value.charCodeAt(end);
  if (finalCodeUnit >= 0xd800 && finalCodeUnit <= 0xdbff && nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
    end -= 1;
  }
  return value.slice(0, end);
}

async function downloadAttachments(context: CommandContext): Promise<unknown> {
  const { args, options, oauthClient } = context;
  const messageId = argumentAt(args, 0) ?? options.id;
  if (!messageId) throw new CliError("Missing message id.", "message_id_missing");
  const outDir = options.out ?? ".";
  const message = await getMessage({ id: messageId, format: "full", oauthClient });
  const attachments = listAttachments(message.payload).filter(
    (attachment) => options.attachment === undefined || attachment.attachmentId === options.attachment,
  );
  if (attachments.length === 0) throw new CliError("No matching attachments.", "attachments_not_found");
  await mkdir(outDir, { recursive: true });
  const saved = [];
  for (const attachment of attachments) {
    const data = await getAttachment({
      messageId,
      attachmentId: attachment.attachmentId,
      oauthClient,
    });
    if (typeof data.data !== "string") {
      throw new CliError("Attachment response did not include data.", "attachment_data_missing");
    }
    const content = base64urlDecode(data.data);
    const file = join(outDir, basename(attachment.filename));
    try {
      await writeFile(file, content, { flag: options.force === true ? "w" : "wx" });
    } catch (error) {
      if (isFileExists(error)) {
        throw new CliError("Attachment destination already exists. Use --force to overwrite it.", "file_exists", {
          path: file,
        });
      }
      throw new CliError("Failed to write attachment.", "file_write_failed", {
        path: file,
        cause: errorMessage(error),
      });
    }
    saved.push({ file, bytes: content.byteLength, attachmentId: attachment.attachmentId });
  }
  return { ok: true, downloaded: saved };
}

function isFileExists(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "EEXIST";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
