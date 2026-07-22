import { GMAIL_SCOPES, type OAuthClient } from "@/auth";
import { gmailRequest } from "./transport";
import type { GmailLabel, ListLabelsResponse } from "./types";

export function listLabels(oauthClient?: OAuthClient): Promise<ListLabelsResponse> {
  return gmailRequest({
    method: "GET",
    path: "/users/me/labels",
    acceptedScopes: [GMAIL_SCOPES.readonly, GMAIL_SCOPES.metadata, GMAIL_SCOPES.labels],
    oauthClient,
  });
}

export function createLabel(options: { name: string; oauthClient?: OAuthClient }): Promise<GmailLabel> {
  return gmailRequest({
    method: "POST",
    path: "/users/me/labels",
    body: { name: options.name, labelListVisibility: "labelShow", messageListVisibility: "show" },
    acceptedScopes: [GMAIL_SCOPES.labels, GMAIL_SCOPES.modify],
    oauthClient: options.oauthClient,
  });
}

export function patchLabel(options: {
  id: string;
  name: string;
  oauthClient?: OAuthClient;
}): Promise<GmailLabel> {
  return gmailRequest({
    method: "PATCH",
    path: `/users/me/labels/${encodeURIComponent(options.id)}`,
    body: { name: options.name },
    acceptedScopes: [GMAIL_SCOPES.labels, GMAIL_SCOPES.modify],
    oauthClient: options.oauthClient,
  });
}

export function deleteLabel(options: { id: string; oauthClient?: OAuthClient }): Promise<Record<string, never>> {
  return gmailRequest({
    method: "DELETE",
    path: `/users/me/labels/${encodeURIComponent(options.id)}`,
    acceptedScopes: [GMAIL_SCOPES.labels, GMAIL_SCOPES.modify],
    oauthClient: options.oauthClient,
  });
}
