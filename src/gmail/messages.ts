import { GMAIL_SCOPES, type OAuthClient } from "@/auth";
import { CliError } from "@/utils";
import pLimit from "p-limit";
import { buildRaw, header, type AttachmentInput } from "./mime";
import { gmailRequest } from "./transport";
import type {
  BatchModifyResult,
  GmailMessage,
  GmailMessagePartBody,
  ListMessagesResponse,
  ListMessagesWithSummariesResponse,
  MessageSummary,
} from "./types";

export function listMessages(options: {
  q?: string;
  maxResults?: number;
  pageToken?: string;
  labelIds?: string[];
  includeSpamTrash?: boolean;
  oauthClient?: OAuthClient;
}): Promise<ListMessagesResponse> {
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
    acceptedScopes: options.q === undefined
      ? [GMAIL_SCOPES.readonly, GMAIL_SCOPES.metadata]
      : [GMAIL_SCOPES.readonly],
    oauthClient: options.oauthClient,
  });
}

export function getMessage(options: {
  id: string;
  format?: string;
  metadataHeaders?: string[];
  oauthClient?: OAuthClient;
}): Promise<GmailMessage> {
  return gmailRequest({
    method: "GET",
    path: `/users/me/messages/${encodeURIComponent(options.id)}`,
    query: { format: options.format, metadataHeaders: options.metadataHeaders },
    acceptedScopes: options.format === "metadata" || options.format === "minimal"
      ? [GMAIL_SCOPES.readonly, GMAIL_SCOPES.metadata]
      : [GMAIL_SCOPES.readonly],
    oauthClient: options.oauthClient,
  });
}

export async function summarizeMessages(
  response: ListMessagesResponse,
  oauthClient?: OAuthClient,
  concurrency = 6,
): Promise<ListMessagesWithSummariesResponse> {
  const limit = pLimit(concurrency);
  const summaries = await limit.map(response.messages ?? [], async (reference): Promise<MessageSummary> => {
    const id = reference.id;
    if (!id) return { id: "", error: { code: "message_id_missing", message: "List item did not include an id." } };
    try {
      const message = await getMessage({
        id,
        format: "metadata",
        metadataHeaders: ["From", "To", "Date", "Subject"],
        oauthClient,
      });
      return {
        id,
        threadId: message.threadId ?? reference.threadId,
        from: header(message.payload, "From") || undefined,
        to: header(message.payload, "To") || undefined,
        date: header(message.payload, "Date") || undefined,
        subject: header(message.payload, "Subject") || undefined,
        snippet: message.snippet,
        labelIds: message.labelIds,
      };
    } catch (error) {
      return { id, threadId: reference.threadId, error: summaryError(error) };
    }
  });
  return { ...response, summaries };
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
}): Promise<GmailMessage> {
  return gmailRequest({
    method: "POST",
    path: "/users/me/messages/send",
    body: {
      raw: buildRaw(options),
      ...(options.threadId === undefined ? {} : { threadId: options.threadId }),
    },
    acceptedScopes: [GMAIL_SCOPES.send],
    oauthClient: options.oauthClient,
  });
}

export function getAttachment(options: {
  messageId: string;
  attachmentId: string;
  oauthClient?: OAuthClient;
}): Promise<GmailMessagePartBody> {
  return gmailRequest({
    method: "GET",
    path: `/users/me/messages/${encodeURIComponent(options.messageId)}/attachments/${encodeURIComponent(options.attachmentId)}`,
    acceptedScopes: [GMAIL_SCOPES.readonly],
    oauthClient: options.oauthClient,
  });
}

export async function modifyMessages(options: {
  ids: string[];
  addLabelIds?: string[];
  removeLabelIds?: string[];
  oauthClient?: OAuthClient;
}): Promise<GmailMessage | Record<string, never> | BatchModifyResult> {
  if (options.ids.length === 1) {
    return gmailRequest({
      method: "POST",
      path: `/users/me/messages/${encodeURIComponent(options.ids[0]!)}/modify`,
      body: { addLabelIds: options.addLabelIds ?? [], removeLabelIds: options.removeLabelIds ?? [] },
      acceptedScopes: [GMAIL_SCOPES.modify],
      oauthClient: options.oauthClient,
    });
  }

  const responses: Array<Record<string, never>> = [];
  for (let index = 0; index < options.ids.length; index += 1000) {
    try {
      responses.push(await gmailRequest({
        method: "POST",
        path: "/users/me/messages/batchModify",
        body: {
          ids: options.ids.slice(index, index + 1000),
          addLabelIds: options.addLabelIds ?? [],
          removeLabelIds: options.removeLabelIds ?? [],
        },
        acceptedScopes: [GMAIL_SCOPES.modify],
        oauthClient: options.oauthClient,
      }));
    } catch (error) {
      throw new CliError("Gmail batch modify failed after partially completing.", "gmail_partial_failure", {
        operation: "batchModify",
        completedBatches: responses.length,
        completedMessages: index,
        failedBatchSize: Math.min(1000, options.ids.length - index),
        cause: errorDetails(error),
      });
    }
  }
  return responses.length === 1 ? responses[0]! : { responses };
}

export function messageAction(options: {
  id: string;
  action: "trash" | "untrash";
  oauthClient?: OAuthClient;
}): Promise<GmailMessage> {
  return gmailRequest({
    method: "POST",
    path: `/users/me/messages/${encodeURIComponent(options.id)}/${options.action}`,
    acceptedScopes: [GMAIL_SCOPES.modify],
    oauthClient: options.oauthClient,
  });
}

function errorDetails(error: unknown): unknown {
  if (error instanceof CliError) {
    return { code: error.code, message: error.message, details: error.details };
  }
  return { code: "internal_error", message: error instanceof Error ? error.message : String(error) };
}

function summaryError(error: unknown): { code: string; message: string } {
  return error instanceof CliError
    ? { code: error.code, message: error.message }
    : { code: "internal_error", message: error instanceof Error ? error.message : String(error) };
}
