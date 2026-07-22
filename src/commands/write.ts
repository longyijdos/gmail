import {
  base64urlDecode,
  createDraft,
  deleteDraft,
  extractBody,
  getAttachment,
  getMessage,
  header,
  htmlToText,
  listAttachments,
  listDrafts,
  parseAddresses,
  profile,
  sendDraft,
  sendMessage,
  type AttachmentInput,
} from "@/gmail";
import { CliError } from "@/utils";
import {
  argumentAt,
  escapeHtml,
  resolveAttachments,
  resolveBody,
  resolveOptionalBody,
} from "./helpers";
import type { CommandContext } from "./types";

export async function handleWriteCommand(context: CommandContext): Promise<unknown> {
  const { id, args, options, oauthClient } = context;
  if (id === "messages.send") return send(context);
  if (id === "messages.reply") return reply(context);
  if (id === "messages.forward") return forward(context);
  if (id === "drafts.create") return draft(context);
  if (id === "drafts.list") {
    return {
      ok: true,
      data: await listDrafts({
        maxResults: stringNumber(options.maxResults),
        pageToken: options.pageToken,
        q: options.q,
        includeSpamTrash: stringBoolean(options.includeSpamTrash),
        oauthClient,
      }),
    };
  }
  const draftId = argumentAt(args, 0) ?? options.id;
  if (!draftId) throw new CliError("Missing draft id.", "draft_id_missing");
  if (id === "drafts.send") return { ok: true, data: await sendDraft({ id: draftId, oauthClient }) };
  await deleteDraft({ id: draftId, oauthClient });
  return { ok: true, deleted: true, draftId };
}

async function send(context: CommandContext): Promise<unknown> {
  const { options, oauthClient } = context;
  const to = addressOptions(options.to);
  const body = await resolveBody(options);
  if (to.length === 0) throw new CliError("Missing --to.", "recipient_missing");
  if (options.subject === undefined) throw new CliError("Missing --subject.", "subject_missing");
  return {
    ok: true,
    data: await sendMessage({
      to,
      cc: options.cc,
      bcc: options.bcc,
      from: options.from,
      subject: options.subject,
      ...body,
      attachments: await resolveAttachments(options),
      oauthClient,
    }),
  };
}

async function reply(context: CommandContext): Promise<unknown> {
  const { args, options, oauthClient } = context;
  const messageId = argumentAt(args, 0) ?? options.id;
  if (!messageId) throw new CliError("Missing message id.", "message_id_missing");
  const original = await getMessage({
    id: messageId,
    format: "metadata",
    metadataHeaders: ["From", "To", "Cc", "Subject", "Message-ID", "References", "Reply-To"],
    oauthClient,
  }) as Record<string, unknown>;
  const payload = original.payload;
  const me = ((await profile(oauthClient)) as { emailAddress?: string }).emailAddress?.toLowerCase();
  const from = parseAddresses(header(payload, "Reply-To") || header(payload, "From"));
  const to = from.map((address) => address.raw);
  const cc: string[] = [];
  if (options.all === true) {
    const seen = new Set([me, ...from.map((address) => address.email.toLowerCase())].filter(Boolean));
    for (const address of [...parseAddresses(header(payload, "To")), ...parseAddresses(header(payload, "Cc"))]) {
      const key = address.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cc.push(address.raw);
    }
  }
  const subject = header(payload, "Subject");
  const originalMessageId = header(payload, "Message-ID");
  const references = [header(payload, "References"), originalMessageId].filter(Boolean).join(" ");
  return {
    ok: true,
    data: await sendMessage({
      to,
      cc,
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      ...(await resolveBody(options)),
      attachments: await resolveAttachments(options),
      threadId: typeof original.threadId === "string" ? original.threadId : undefined,
      inReplyTo: originalMessageId || undefined,
      references: references || undefined,
      oauthClient,
    }),
  };
}

async function forward(context: CommandContext): Promise<unknown> {
  const { args, options, oauthClient } = context;
  const messageId = argumentAt(args, 0) ?? options.id;
  const to = addressOptions(options.to);
  if (!messageId || to.length === 0) {
    throw new CliError("Usage: gml forward <message-id> --to <addr>", "args_invalid");
  }
  const original = await getMessage({ id: messageId, format: "full", oauthClient }) as Record<string, unknown>;
  const payload = original.payload;
  const body = extractBody(payload);
  const intro = await resolveOptionalBody(options);
  const forwardedHeader = [
    "---------- Forwarded message ----------",
    `From: ${header(payload, "From")}`,
    `Date: ${header(payload, "Date")}`,
    `Subject: ${header(payload, "Subject")}`,
    `To: ${header(payload, "To")}`,
    "",
  ].join("\n");
  const originalAttachments: AttachmentInput[] = [];
  if (options.attachments !== false) {
    for (const attachment of listAttachments(payload)) {
      const data = await getAttachment({
        messageId,
        attachmentId: attachment.attachmentId,
        oauthClient,
      }) as Record<string, unknown>;
      if (typeof data.data === "string") {
        originalAttachments.push({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          content: base64urlDecode(data.data),
        });
      }
    }
  }
  const subject = header(payload, "Subject");
  return {
    ok: true,
    data: await sendMessage({
      to,
      cc: options.cc,
      bcc: options.bcc,
      subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`,
      ...(options.html === true
        ? { html: `${intro.html ?? ""}<br><br>${escapeHtml(forwardedHeader).replace(/\n/g, "<br>")}<br>${body.html || `<pre>${escapeHtml(body.text)}</pre>`}` }
        : { text: `${intro.text ?? ""}\n\n${forwardedHeader}\n${body.text || htmlToText(body.html)}` }),
      attachments: [...originalAttachments, ...(await resolveAttachments(options))],
      oauthClient,
    }),
  };
}

async function draft(context: CommandContext): Promise<unknown> {
  const { options, oauthClient } = context;
  const to = addressOptions(options.to);
  if (to.length === 0 || options.subject === undefined) {
    throw new CliError("Usage: gml draft --to <addr> --subject <subject> --body <body>", "args_invalid");
  }
  return {
    ok: true,
    data: await createDraft({
      to,
      cc: options.cc,
      bcc: options.bcc,
      from: options.from,
      subject: options.subject,
      ...(await resolveBody(options)),
      attachments: await resolveAttachments(options),
      oauthClient,
    }),
  };
}

function addressOptions(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

function stringNumber(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function stringBoolean(value: boolean | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}
