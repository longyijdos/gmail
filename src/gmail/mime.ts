import { basename, extname } from "node:path";

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
  const headers = [
    ...(options.from === undefined ? [] : [`From: ${options.from}`]),
    `To: ${options.to.join(", ")}`,
    ...(options.cc?.length ? [`Cc: ${options.cc.join(", ")}`] : []),
    ...(options.bcc?.length ? [`Bcc: ${options.bcc.join(", ")}`] : []),
    `Subject: ${encodeHeader(options.subject)}`,
    ...(options.inReplyTo === undefined ? [] : [`In-Reply-To: ${options.inReplyTo}`]),
    ...(options.references === undefined ? [] : [`References: ${options.references}`]),
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
    .replace(/&quot;/g, "\"")
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
  return value
    .split(",")
    .map((part) => {
      const raw = part.trim();
      const match = raw.match(/<([^>]+)>/);
      const email = (match?.[1] ?? raw).trim();
      const name = match?.index === undefined
        ? undefined
        : raw.slice(0, match.index).trim().replace(/^"|"$/g, "") || undefined;
      return { ...(name === undefined ? {} : { name }), email, raw };
    })
    .filter((address) => address.email);
}

function encodeHeader(value: string): string {
  return /^[\x20-\x7E]*$/.test(value)
    ? value
    : `=?UTF-8?B?${Buffer.from(value).toString("base64")}?=`;
}

function buildBody(options: {
  text?: string;
  html?: string;
  attachments?: AttachmentInput[];
}): { headers: string[]; body: string } {
  let bodyHeaders: string[];
  let body: string;
  if (options.html !== undefined) {
    const boundary = `alt_${crypto.randomUUID().replace(/-/g, "")}`;
    const text = options.text ?? htmlToText(options.html);
    bodyHeaders = [`Content-Type: multipart/alternative; boundary="${boundary}"`];
    body = [
      `--${boundary}`,
      part(["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64"], Buffer.from(text, "utf8").toString("base64")),
      `--${boundary}`,
      part(["Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64"], Buffer.from(options.html, "utf8").toString("base64")),
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
    const filename = encodeHeader(attachment.filename || basename(attachment.filename));
    return part(
      [
        `Content-Type: ${attachment.mimeType ?? guessMimeType(attachment.filename)}; name="${filename}"`,
        "Content-Transfer-Encoding: base64",
        `Content-Disposition: attachment; filename="${filename}"`,
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
