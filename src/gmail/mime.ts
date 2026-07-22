import { basename, extname } from "node:path";
import emailAddresses from "email-addresses";
import { CliError } from "@/utils";

export type AttachmentInput = {
  filename: string;
  mimeType?: string;
  content: Uint8Array;
};

export function encodeMime(options: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  subject: string;
  text: string;
  html?: string;
  attachments?: AttachmentInput[];
  inReplyTo?: string;
  references?: string;
}): string {
  return buildRaw(options);
}

export function buildRaw(options: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: AttachmentInput[];
  inReplyTo?: string;
  references?: string;
}): string {
  const to = formatAddressInputs(options.to, "To", true);
  const cc = formatAddressInputs(options.cc ?? [], "Cc");
  const bcc = formatAddressInputs(options.bcc ?? [], "Bcc");
  const from = options.from === undefined ? undefined : formatSingleAddress(options.from, "From");
  const headers = [
    ...(from === undefined ? [] : [`From: ${from}`]),
    `To: ${to.join(", ")}`,
    ...(cc.length ? [`Cc: ${cc.join(", ")}`] : []),
    ...(bcc.length ? [`Bcc: ${bcc.join(", ")}`] : []),
    `Subject: ${encodeHeader(assertHeaderValue(options.subject, "Subject"))}`,
    ...(options.inReplyTo === undefined ? [] : [`In-Reply-To: ${assertHeaderValue(options.inReplyTo, "In-Reply-To")}`]),
    ...(options.references === undefined ? [] : [`References: ${assertHeaderValue(options.references, "References")}`]),
    "MIME-Version: 1.0",
  ];
  const body = buildBody(options);
  return Buffer.from([...headers, ...body.headers, "", body.body].join("\r\n"), "utf8").toString("base64url");
}

export function base64urlDecode(value: string): Buffer {
  return Buffer.from(value.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function header(payload: unknown, name: string): string {
  const object = asRecord(payload);
  const headers = Array.isArray(object?.headers) ? object.headers : [];
  const found = headers.find((item) => {
    const record = asRecord(item);
    return typeof record?.name === "string" && record.name.toLowerCase() === name.toLowerCase();
  });
  const record = asRecord(found);
  return typeof record?.value === "string" ? record.value : "";
}

export function extractBody(payload: unknown): { text: string; html: string } {
  const result = { text: "", html: "" };
  function walk(part: unknown): void {
    const object = asRecord(part);
    if (object === undefined) return;
    const mimeType = typeof object.mimeType === "string" ? object.mimeType : "";
    const body = asRecord(object.body);
    if (typeof body?.data === "string") {
      const decoded = base64urlDecode(body.data).toString("utf8");
      if (mimeType === "text/plain" && !result.text) result.text = decoded;
      if (mimeType === "text/html" && !result.html) result.html = decoded;
    }
    if (Array.isArray(object.parts)) {
      for (const child of object.parts) walk(child);
    }
  }
  walk(payload);
  return result;
}

export function listAttachments(payload: unknown): Array<{
  filename: string;
  mimeType: string;
  size?: number;
  attachmentId: string;
}> {
  const result: Array<{ filename: string; mimeType: string; size?: number; attachmentId: string }> = [];
  function walk(part: unknown): void {
    const object = asRecord(part);
    if (object === undefined) return;
    const body = asRecord(object.body);
    if (typeof object.filename === "string" && object.filename && typeof body?.attachmentId === "string") {
      result.push({
        filename: object.filename,
        mimeType: typeof object.mimeType === "string" ? object.mimeType : "application/octet-stream",
        ...(typeof body.size === "number" ? { size: body.size } : {}),
        attachmentId: body.attachmentId,
      });
    }
    if (Array.isArray(object.parts)) {
      for (const child of object.parts) walk(child);
    }
  }
  walk(payload);
  return result;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<\/(p|div|tr|h[1-6]|li)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function guessMimeType(filePath: string): string {
  const types: Record<string, string> = {
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".svg": "image/svg+xml",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".html": "text/html",
    ".json": "application/json",
    ".zip": "application/zip",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
  return types[extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

export function parseAddresses(value: string): Array<{ name?: string; email: string; raw: string }> {
  if (!value) return [];
  assertHeaderValue(value, "address");
  const parsed = emailAddresses.parseAddressList({
    input: value,
    rfc6532: true,
    strict: true,
  });
  if (parsed === null) {
    throw new CliError("Invalid email address list.", "address_invalid", { value });
  }
  return parsed
    .flatMap((item) => (item.type === "group" ? item.addresses : [item]))
    .map((mailbox) => ({
      ...(mailbox.name === null ? {} : { name: mailbox.name }),
      email: mailbox.address,
      raw: formatMailbox(mailbox.name, mailbox.address),
    }));
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value) ? value : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function buildBody(options: { text?: string; html?: string; attachments?: AttachmentInput[] }): {
  headers: string[];
  body: string;
} {
  let bodyHeaders: string[];
  let body: string;
  if (options.html !== undefined) {
    const boundary = `alt_${crypto.randomUUID().replace(/-/g, "")}`;
    const text = options.text ?? htmlToText(options.html);
    bodyHeaders = [`Content-Type: multipart/alternative; boundary="${boundary}"`];
    body = [
      `--${boundary}`,
      part(
        ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"],
        Buffer.from(text, "utf8").toString("base64"),
      ),
      `--${boundary}`,
      part(
        ["Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64"],
        Buffer.from(options.html, "utf8").toString("base64"),
      ),
      `--${boundary}--`,
    ].join("\r\n");
  } else {
    bodyHeaders = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"];
    body = wrap76(Buffer.from(options.text ?? "", "utf8").toString("base64"));
  }

  if (!options.attachments?.length) return { headers: bodyHeaders, body };

  const boundary = `mix_${crypto.randomUUID().replace(/-/g, "")}`;
  const bodyPart = [...bodyHeaders, "", body].join("\r\n");
  const attachmentParts = options.attachments.map((attachment) => {
    const filename = assertHeaderValue(
      attachment.filename || basename(attachment.filename) || "attachment",
      "attachment filename",
    );
    const fallbackFilename = filename.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "\\$&");
    const encodedFilename = encodeParameter(filename);
    const mimeType = safeMimeType(attachment.mimeType ?? guessMimeType(attachment.filename));
    return part(
      [
        `Content-Type: ${mimeType}`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
      ],
      Buffer.from(attachment.content).toString("base64"),
    );
  });
  return {
    headers: [`Content-Type: multipart/mixed; boundary="${boundary}"`],
    body: [
      `--${boundary}`,
      bodyPart,
      ...attachmentParts.flatMap((attachment) => [`--${boundary}`, attachment]),
      `--${boundary}--`,
    ].join("\r\n"),
  };
}

function part(headers: string[], base64Body: string): string {
  return [...headers, "", wrap76(base64Body)].join("\r\n");
}

function wrap76(value: string): string {
  return value.replace(/(.{76})/g, "$1\r\n");
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function formatAddressInputs(values: string[], headerName: string, required = false): string[] {
  const addresses = values.flatMap((value) => parseAddresses(value));
  if (required && addresses.length === 0) {
    throw new CliError(`${headerName} requires at least one email address.`, "address_invalid", {
      header: headerName,
    });
  }
  return addresses.map((address) => address.raw);
}

function formatSingleAddress(value: string, headerName: string): string {
  const addresses = parseAddresses(value);
  const [address] = addresses;
  if (address === undefined || addresses.length !== 1) {
    throw new CliError(`${headerName} requires exactly one email address.`, "address_invalid", {
      header: headerName,
    });
  }
  return address.raw;
}

function formatMailbox(name: string | null, address: string): string {
  const safeAddress = assertHeaderValue(address, "email address");
  if (!name) return safeAddress;
  const safeName = assertHeaderValue(name, "display name");
  const phrase = /^[\x20-\x7E]*$/.test(safeName) ? `"${safeName.replace(/["\\]/g, "\\$&")}"` : encodeHeader(safeName);
  return `${phrase} <${safeAddress}>`;
}

function assertHeaderValue(value: string, name: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new CliError(`${name} cannot contain line breaks or null bytes.`, "header_invalid", {
      header: name,
    });
  }
  return value;
}

function safeMimeType(value: string): string {
  return /^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*$/.test(value)
    ? value
    : "application/octet-stream";
}

function encodeParameter(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}
