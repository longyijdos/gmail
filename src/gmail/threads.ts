import { GMAIL_SCOPES, type OAuthClient } from "@/auth";
import { gmailRequest } from "./transport";
import type { GmailThread, ListThreadsResponse } from "./types";

export function listThreads(options: {
  q?: string;
  maxResults?: number;
  pageToken?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
  oauthClient?: OAuthClient;
}): Promise<ListThreadsResponse> {
  return gmailRequest({
    method: "GET",
    path: "/users/me/threads",
    query: {
      q: options.q,
      maxResults: options.maxResults,
      pageToken: options.pageToken,
      labelIds: options.labelIds,
      includeSpamTrash: options.includeSpamTrash,
    },
    acceptedScopes: options.q === undefined
      ? [GMAIL_SCOPES.readonly, GMAIL_SCOPES.metadata]
      : [GMAIL_SCOPES.readonly],
    oauthClient: options.oauthClient,
  });
}

export function getThread(options: {
  id: string;
  format?: string;
  metadataHeaders?: string[];
  oauthClient?: OAuthClient;
}): Promise<GmailThread> {
  return gmailRequest({
    method: "GET",
    path: `/users/me/threads/${encodeURIComponent(options.id)}`,
    query: { format: options.format, metadataHeaders: options.metadataHeaders },
    acceptedScopes: options.format === "metadata" || options.format === "minimal"
      ? [GMAIL_SCOPES.readonly, GMAIL_SCOPES.metadata]
      : [GMAIL_SCOPES.readonly],
    oauthClient: options.oauthClient,
  });
}
