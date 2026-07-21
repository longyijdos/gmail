import { CliError, many, one } from "../cli";
import {
  base64urlDecode,
  createDraft,
  deleteDraft,
  extractBody,
  getAttachment,
  getMessage,
  header,
  listAttachments,
  listDrafts,
  parseAddresses,
  profile,
  sendDraft,
  sendMessage,
  type AttachmentInput,
} from "../gmail";
import {
  escapeHtml,
  resolveAttachments,
  resolveBody,
  resolveOptionalBody,
} from "./helpers";
import type { CommandContext } from "./types";

export async function handleWriteCommand(context: CommandContext): Promise<unknown | undefined> {
  const { parsed, command, subcommand, oauthClient } = context;
  if (command === "send") return send(context);
  if (command === "reply") return reply(context);
  if (command === "forward") return forward(context);
  if (command === "draft") return draft(context);
  if (command === "drafts") return { ok: true, data: await listDrafts({ maxResults: one(parsed.flags, "max-results"), oauthClient }) };
  if (command === "draft-send") {
    const id = subcommand ?? one(parsed.flags, "id");
    if (!id) throw new CliError("Missing draft id.", "draft_id_missing");
    return { ok: true, data: await sendDraft({ id, oauthClient }) };
  }
  if (command === "draft-delete") {
    const id = subcommand ?? one(parsed.flags, "id");
    if (!id) throw new CliError("Missing draft id.", "draft_id_missing");
    await deleteDraft({ id, oauthClient });
    return { ok: true, deleted: true, draftId: id };
  }
  return undefined;
}

async function send(context: CommandContext): Promise<unknown> {
  const { parsed, oauthClient } = context;
  const to = many(parsed.flags, "to");
  const subject = one(parsed.flags, "subject");
  const body = await resolveBody(parsed.flags);
  if (to.length === 0) throw new CliError("Missing --to.", "recipient_missing");
  if (subject === undefined) throw new CliError("Missing --subject.", "subject_missing");
  return {
    ok: true,
    data: await sendMessage({
      to,
      cc: many(parsed.flags, "cc"),
      bcc: many(parsed.flags, "bcc"),
      from: one(parsed.flags, "from"),
      subject,
      ...body,
      attachments: await resolveAttachments(parsed.flags),
      oauthClient,
    }),
  };
}

async function reply(context: CommandContext): Promise<unknown> {
  const { parsed, subcommand, oauthClient } = context;
  const id = subcommand ?? one(parsed.flags, "id");
  if (!id) throw new CliError("Missing message id.", "message_id_missing");
  const original = await getMessage({
    id,
    format: "metadata",
    metadataHeaders: ["From", "To", "Cc", "Subject", "Message-ID", "References", "Reply-To"],
    oauthClient,
  }) as Record<string, unknown>;
  const payload = original.payload;
  const me = ((await profile(oauthClient)) as { emailAddress?: string }).emailAddress?.toLowerCase();
  const from = parseAddresses(header(payload, "Reply-To") || header(payload, "From"));
  const to = from.map((address) => address.raw);
  const cc: string[] = [];
  if (one(parsed.flags, "all") !== undefined) {
    const seen = new Set([me, ...from.map((address) => address.email.toLowerCase())].filter(Boolean));
    for (const address of [...parseAddresses(header(payload, "To")), ...parseAddresses(header(payload, "Cc"))]) {
      const key = address.email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cc.push(address.raw);
    }
  }
  const subject = header(payload, "Subject");
  const messageId = header(payload, "Message-ID");
  const references = [header(payload, "References"), messageId].filter(Boolean).join(" ");
  return {
    ok: true,
    data: await sendMessage({
      to,
      cc,
      subject: /^re:/i.test(subject) ? subject : `Re: ${subject}`,
      ...(await resolveBody(parsed.flags)),
      attachments: await resolveAttachments(parsed.flags),
      threadId: typeof original.threadId === "string" ? original.threadId : undefined,
      inReplyTo: messageId || undefined,
      references: references || undefined,
      oauthClient,
    }),
  };
}

async function forward(context: CommandContext): Promise<unknown> {
  const { parsed, subcommand, oauthClient } = context;
  const id = subcommand ?? one(parsed.flags, "id");
  const to = many(parsed.flags, "to");
  if (!id || to.length === 0) throw new CliError("Usage: gml forward <message-id> --to <addr>", "args_invalid");
  const original = await getMessage({ id, format: "full", oauthClient }) as Record<string, unknown>;
  const payload = original.payload;
  const body = extractBody(payload);
  const intro = await resolveOptionalBody(parsed.flags);
  const forwardedHeader = [
    "---------- Forwarded message ----------",
    `From: ${header(payload, "From")}`,
    `Date: ${header(payload, "Date")}`,
    `Subject: ${header(payload, "Subject")}`,
    `To: ${header(payload, "To")}`,
    "",
  ].join("\n");
  const originalAttachments: AttachmentInput[] = [];
  if (one(parsed.flags, "no-attachments") === undefined) {
    for (const attachment of listAttachments(payload)) {
      const data = await getAttachment({ messageId: id, attachmentId: attachment.attachmentId, oauthClient }) as Record<string, unknown>;
      if (typeof data.data === "string") {
        originalAttachments.push({
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          content: base64urlDecode(data.data),
        });
      }
    }
  }
  const html = one(parsed.flags, "html") !== undefined;
  const subject = header(payload, "Subject");
  return {
    ok: true,
    data: await sendMessage({
      to,
      cc: many(parsed.flags, "cc"),
      bcc: many(parsed.flags, "bcc"),
      subject: /^fwd?:/i.test(subject) ? subject : `Fwd: ${subject}`,
      ...(html
        ? { html: `${intro.html ?? ""}<br><br>${escapeHtml(forwardedHeader).replace(/\n/g, "<br>")}<br>${body.html || `<pre>${escapeHtml(body.text)}</pre>`}` }
        : { text: `${intro.text ?? ""}\n\n${forwardedHeader}\n${body.text || body.html}` }),
      attachments: [...originalAttachments, ...(await resolveAttachments(parsed.flags))],
      oauthClient,
    }),
  };
}

async function draft(context: CommandContext): Promise<unknown> {
  const { parsed, oauthClient } = context;
  const to = many(parsed.flags, "to");
  const subject = one(parsed.flags, "subject");
  if (to.length === 0 || subject === undefined) throw new CliError("Usage: gml draft --to <addr> --subject <subject> --body <body>", "args_invalid");
  return {
    ok: true,
    data: await createDraft({
      to,
      cc: many(parsed.flags, "cc"),
      bcc: many(parsed.flags, "bcc"),
      from: one(parsed.flags, "from"),
      subject,
      ...(await resolveBody(parsed.flags)),
      attachments: await resolveAttachments(parsed.flags),
      oauthClient,
    }),
  };
}
