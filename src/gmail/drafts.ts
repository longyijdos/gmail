import { GMAIL_SCOPES, type OAuthClient } from "@/auth";
import { buildRaw, type AttachmentInput } from "./mime";
import { gmailRequest } from "./transport";
import type { GmailDraft, GmailMessage, ListDraftsResponse } from "./types";

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
}): Promise<GmailDraft> {
  return gmailRequest({
    method: "POST",
    path: "/users/me/drafts",
    body: { message: { raw: buildRaw(options) } },
    acceptedScopes: [GMAIL_SCOPES.compose],
    oauthClient: options.oauthClient,
  });
}

export function listDrafts(options: {
  maxResults?: number;
  pageToken?: string;
  q?: string;
  includeSpamTrash?: boolean;
  oauthClient?: OAuthClient;
}): Promise<ListDraftsResponse> {
  return gmailRequest({
    method: "GET",
    path: "/users/me/drafts",
    query: {
      maxResults: options.maxResults,
      pageToken: options.pageToken,
      q: options.q,
      includeSpamTrash: options.includeSpamTrash,
    },
    acceptedScopes: [GMAIL_SCOPES.readonly, GMAIL_SCOPES.compose],
    oauthClient: options.oauthClient,
  });
}

export function sendDraft(options: { id: string; oauthClient?: OAuthClient }): Promise<GmailMessage> {
  return gmailRequest({
    method: "POST",
    path: "/users/me/drafts/send",
    body: { id: options.id },
    acceptedScopes: [GMAIL_SCOPES.compose],
    oauthClient: options.oauthClient,
  });
}

export function deleteDraft(options: { id: string; oauthClient?: OAuthClient }): Promise<Record<string, never>> {
  return gmailRequest({
    method: "DELETE",
    path: `/users/me/drafts/${encodeURIComponent(options.id)}`,
    acceptedScopes: [GMAIL_SCOPES.compose],
    oauthClient: options.oauthClient,
  });
}
