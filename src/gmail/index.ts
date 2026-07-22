export { createDraft, deleteDraft, listDrafts, sendDraft } from "./drafts";
export { createLabel, deleteLabel, listLabels, patchLabel } from "./labels";
export {
  getAttachment,
  getMessage,
  listMessages,
  messageAction,
  modifyMessages,
  sendMessage,
  summarizeMessages,
} from "./messages";
export {
  type AttachmentInput,
  base64urlDecode,
  buildRaw,
  encodeMime,
  extractBody,
  guessMimeType,
  header,
  htmlToText,
  listAttachments,
  parseAddresses,
} from "./mime";
export { profile } from "./profile";
export { getThread, listThreads } from "./threads";
export { gmailRequest, type QueryValue, type RequestOptions } from "./transport";
export type {
  BatchModifyResult,
  GmailDraft,
  GmailHeader,
  GmailLabel,
  GmailMessage,
  GmailMessagePart,
  GmailMessagePartBody,
  GmailProfile,
  GmailThread,
  ListDraftsResponse,
  ListLabelsResponse,
  ListMessagesResponse,
  ListMessagesWithSummariesResponse,
  ListThreadsResponse,
  MessageSummary,
} from "./types";
