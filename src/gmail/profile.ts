import { GMAIL_SCOPES, type OAuthClient } from "@/auth";
import { gmailRequest } from "./transport";
import type { GmailProfile } from "./types";

export function profile(oauthClient?: OAuthClient): Promise<GmailProfile> {
  return gmailRequest({
    method: "GET",
    path: "/users/me/profile",
    acceptedScopes: [GMAIL_SCOPES.readonly, GMAIL_SCOPES.metadata, GMAIL_SCOPES.compose],
    oauthClient,
  });
}
