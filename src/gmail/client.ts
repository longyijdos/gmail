import { getAccessToken, GMAIL_SCOPES, type OAuthClient } from "../auth";
import { CliError } from "../cli";
import { buildRaw, type AttachmentInput } from "./mime";

const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1";

export type RequestOptions = {
  method: string;
  path: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
  requiredScopes?: string[];
  oauthClient?: OAuthClient;
};

export async function gmailRequest(options: RequestOptions): Promise<unknown> {
  const token = await getAccessToken(options.requiredScopes, options.oauthClient);
  const url = new URL(normalizePath(options.path), GMAIL_BASE);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else {
      url.searchParams.set(key, value);
    }
  }
  const response = await fetch(url, {
    method: options.method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
      ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new CliError("Gmail API request failed.", "gmail_request_failed", {
      status: response.status,
      method: options.method,
      path: url.pathname,
      response: body,
    });
  }
  return body;
}

export function profile(oauthClient?: OAuthClient): Promise<unknown> {
  return gmailRequest({
    method: "GET",
    path: "/users/me/profile",
    requiredScopes: [GMAIL_SCOPES.readonly],
    oauthClient,
  });
}

export function listLabels(oauthClient?: OAuthClient): Promise<unknown> {
  return gmailRequest({
    method: "GET",
    path: "/users/me/labels",
    requiredScopes: [GMAIL_SCOPES.readonly],
    oauthClient,
  });
}

export function listMessages(options: {
  q?: string;
  maxResults?: string;
  pageToken?: string;
  labelIds?: string[];
  includeSpamTrash?: string;
  oauthClient?: OAuthClient;
}): Promise<unknown> {
  return gmailRequest({
    method: "GET",
    path: "/users/me/messages",
    query: {
      q: options.q,
      maxResults: options.maxResults,
      pageToken: options.pageToken,
      labelIds: options.labelIds,
      includeSpamTrash: options.includeSpamTrash,
    },
    requiredScopes: [GMAIL_SCOPES.readonly],
    oauthClient: options.oauthClient,
  });
}

export function getMessage(options: {
  id: string;
  format?: string;
  metadataHeaders?: string[];
  oauthClient?: OAuthClient;
}): Promise<unknown> {
  return gmailRequest({
    method: "GET",
    path: `/users/me/messages/${encodeURIComponent(options.id)}`,
    query: {
      format: options.format,
      metadataHeaders: options.metadataHeaders,
    },
    requiredScopes: [GMAIL_SCOPES.readonly],
    oauthClient: options.oauthClient,
  });
}

export function sendMessage(options: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: AttachmentInput[];
  threadId?: string;
  inReplyTo?: string;
  references?: string;
  oauthClient?: OAuthClient;
}): Promise<unknown> {
  return gmailRequest({
    method: "POST",
    path: "/users/me/messages/send",
    body: {
      raw: buildRaw(options),
      ...(options.threadId === undefined ? {} : { threadId: options.threadId }),
    },
    requiredScopes: [GMAIL_SCOPES.send],
    oauthClient: options.oauthClient,
  });
}

export function listThreads(options: {
  q?: string;
  maxResults?: string;
  pageToken?: string;
  labelIds?: string[];
  oauthClient?: OAuthClient;
}): Promise<unknown> {
  return gmailRequest({
    method: "GET",
    path: "/users/me/threads",
    query: {
      q: options.q,
      maxResults: options.maxResults,
      pageToken: options.pageToken,
      labelIds: options.labelIds,
    },
    requiredScopes: [GMAIL_SCOPES.readonly],
    oauthClient: options.oauthClient,
  });
}

export function getThread(options: {
  id: string;
  format?: string;
  metadataHeaders?: string[];
  oauthClient?: OAuthClient;
}): Promise<unknown> {
  return gmailRequest({
    method: "GET",
    path: `/users/me/threads/${encodeURIComponent(options.id)}`,
    query: {
      format: options.format,
      metadataHeaders: options.metadataHeaders,
    },
    requiredScopes: [GMAIL_SCOPES.readonly],
    oauthClient: options.oauthClient,
  });
}

export function getAttachment(options: {
  messageId: string;
  attachmentId: string;
  oauthClient?: OAuthClient;
}): Promise<unknown> {
  return gmailRequest({
    method: "GET",
    path: `/users/me/messages/${encodeURIComponent(options.messageId)}/attachments/${encodeURIComponent(options.attachmentId)}`,
    requiredScopes: [GMAIL_SCOPES.readonly],
    oauthClient: options.oauthClient,
  });
}

export function modifyMessages(options: {
  ids: string[];
  addLabelIds?: string[];
  removeLabelIds?: string[];
  oauthClient?: OAuthClient;
}): Promise<unknown> {
  if (options.ids.length === 1) {
    return gmailRequest({
      method: "POST",
      path: `/users/me/messages/${encodeURIComponent(options.ids[0]!)}/modify`,
      body: { addLabelIds: options.addLabelIds ?? [], removeLabelIds: options.removeLabelIds ?? [] },
      requiredScopes: [GMAIL_SCOPES.modify],
      oauthClient: options.oauthClient,
    });
  }
  return gmailRequest({
    method: "POST",
    path: "/users/me/messages/batchModify",
    body: {
      ids: options.ids,
      addLabelIds: options.addLabelIds ?? [],
      removeLabelIds: options.removeLabelIds ?? [],
    },
    requiredScopes: [GMAIL_SCOPES.modify],
    oauthClient: options.oauthClient,
  });
}

export function messageAction(options: {
  id: string;
  action: "trash" | "untrash";
  oauthClient?: OAuthClient;
}): Promise<unknown> {
  return gmailRequest({
    method: "POST",
    path: `/users/me/messages/${encodeURIComponent(options.id)}/${options.action}`,
    requiredScopes: [GMAIL_SCOPES.modify],
    oauthClient: options.oauthClient,
  });
}

export function createLabel(options: { name: string; oauthClient?: OAuthClient }): Promise<unknown> {
  return gmailRequest({
    method: "POST",
    path: "/users/me/labels",
    body: { name: options.name, labelListVisibility: "labelShow", messageListVisibility: "show" },
    requiredScopes: [GMAIL_SCOPES.labels],
    oauthClient: options.oauthClient,
  });
}

export function patchLabel(options: {
  id: string;
  name: string;
  oauthClient?: OAuthClient;
}): Promise<unknown> {
  return gmailRequest({
    method: "PATCH",
    path: `/users/me/labels/${encodeURIComponent(options.id)}`,
    body: { name: options.name },
    requiredScopes: [GMAIL_SCOPES.labels],
    oauthClient: options.oauthClient,
  });
}

export function deleteLabel(options: { id: string; oauthClient?: OAuthClient }): Promise<unknown> {
  return gmailRequest({
    method: "DELETE",
    path: `/users/me/labels/${encodeURIComponent(options.id)}`,
    requiredScopes: [GMAIL_SCOPES.labels],
    oauthClient: options.oauthClient,
  });
}

export function createDraft(options: {
  to: string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  subject: string;
  text?: string;
  html?: string;
  attachments?: AttachmentInput[];
  oauthClient?: OAuthClient;
}): Promise<unknown> {
  return gmailRequest({
    method: "POST",
    path: "/users/me/drafts",
    body: { message: { raw: buildRaw(options) } },
    requiredScopes: [GMAIL_SCOPES.compose],
    oauthClient: options.oauthClient,
  });
}

export function listDrafts(options: { maxResults?: string; oauthClient?: OAuthClient }): Promise<unknown> {
  return gmailRequest({
    method: "GET",
    path: "/users/me/drafts",
    query: { maxResults: options.maxResults },
    requiredScopes: [GMAIL_SCOPES.compose],
    oauthClient: options.oauthClient,
  });
}

export function sendDraft(options: { id: string; oauthClient?: OAuthClient }): Promise<unknown> {
  return gmailRequest({
    method: "POST",
    path: "/users/me/drafts/send",
    body: { id: options.id },
    requiredScopes: [GMAIL_SCOPES.compose],
    oauthClient: options.oauthClient,
  });
}

export function deleteDraft(options: { id: string; oauthClient?: OAuthClient }): Promise<unknown> {
  return gmailRequest({
    method: "DELETE",
    path: `/users/me/drafts/${encodeURIComponent(options.id)}`,
    requiredScopes: [GMAIL_SCOPES.compose],
    oauthClient: options.oauthClient,
  });
}

function normalizePath(value: string): string {
  if (value.startsWith("https://gmail.googleapis.com/gmail/v1/")) {
    return value.slice("https://gmail.googleapis.com/gmail/v1".length);
  }
  if (!value.startsWith("/")) return `/${value}`;
  return value;
}
