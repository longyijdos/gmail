import pLimit from "p-limit";
import { GMAIL_SCOPES, type OAuthClient } from "@/auth";
import { CliError } from "@/utils";
import { header } from "./mime";
import { gmailRequest } from "./transport";
import type { GmailThread, ListThreadsResponse, ListThreadsWithSummariesResponse, ThreadSummary } from "./types";

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
    acceptedScopes: options.q === undefined ? [GMAIL_SCOPES.readonly, GMAIL_SCOPES.metadata] : [GMAIL_SCOPES.readonly],
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
    acceptedScopes:
      options.format === "metadata" || options.format === "minimal"
        ? [GMAIL_SCOPES.readonly, GMAIL_SCOPES.metadata]
        : [GMAIL_SCOPES.readonly],
    oauthClient: options.oauthClient,
  });
}

export async function summarizeThreads(
  response: ListThreadsResponse,
  oauthClient?: OAuthClient,
  concurrency = 6,
): Promise<ListThreadsWithSummariesResponse> {
  const limit = pLimit(concurrency);
  const summaries = await limit.map(response.threads ?? [], async (reference): Promise<ThreadSummary> => {
    const id = reference.id;
    if (!id) {
      return {
        id: "",
        messageCount: 0,
        error: { code: "thread_id_missing", message: "List item did not include an id." },
      };
    }
    try {
      const thread = await getThread({
        id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Date", "Subject"],
        oauthClient,
      });
      const messages = thread.messages ?? [];
      const latest = messages.at(-1);
      return {
        id,
        historyId: thread.historyId ?? reference.historyId,
        messageCount: messages.length,
        latestMessageId: latest?.id,
        from: header(latest?.payload, "From") || undefined,
        to: header(latest?.payload, "To") || undefined,
        date: header(latest?.payload, "Date") || undefined,
        subject: header(latest?.payload, "Subject") || undefined,
        snippet: latest?.snippet ?? reference.snippet,
        labelIds: latest?.labelIds,
      };
    } catch (error) {
      return { id, historyId: reference.historyId, messageCount: 0, error: summaryError(error) };
    }
  });
  return { ...response, summaries };
}

function summaryError(error: unknown): { code: string; message: string } {
  return error instanceof CliError
    ? { code: error.code, message: error.message }
    : { code: "internal_error", message: error instanceof Error ? error.message : String(error) };
}
