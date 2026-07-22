export type GmailProfile = {
  emailAddress: string;
  messagesTotal: number;
  threadsTotal: number;
  historyId: string;
};

export type GmailLabel = {
  id?: string;
  name?: string;
  type?: string;
  messageListVisibility?: string;
  labelListVisibility?: string;
};

export type ListLabelsResponse = {
  labels?: GmailLabel[];
};

export type GmailHeader = {
  name?: string;
  value?: string;
};

export type GmailMessagePartBody = {
  attachmentId?: string;
  size?: number;
  data?: string;
};

export type GmailMessagePart = {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: GmailMessagePartBody;
  parts?: GmailMessagePart[];
};

export type GmailMessage = {
  id?: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  payload?: GmailMessagePart;
  sizeEstimate?: number;
  raw?: string;
};

export type ListMessagesResponse = {
  messages?: Array<Pick<GmailMessage, "id" | "threadId">>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type MessageSummary = {
  id: string;
  threadId?: string;
  from?: string;
  to?: string;
  date?: string;
  subject?: string;
  snippet?: string;
  labelIds?: string[];
  error?: { code: string; message: string };
};

export type ListMessagesWithSummariesResponse = ListMessagesResponse & {
  summaries: MessageSummary[];
};

export type GmailThread = {
  id?: string;
  historyId?: string;
  messages?: GmailMessage[];
  snippet?: string;
};

export type ListThreadsResponse = {
  threads?: Array<Pick<GmailThread, "id" | "historyId" | "snippet">>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type ThreadSummary = {
  id: string;
  historyId?: string;
  messageCount: number;
  latestMessageId?: string;
  from?: string;
  to?: string;
  date?: string;
  subject?: string;
  snippet?: string;
  labelIds?: string[];
  error?: { code: string; message: string };
};

export type ListThreadsWithSummariesResponse = ListThreadsResponse & {
  summaries: ThreadSummary[];
};

export type GmailDraft = {
  id?: string;
  message?: GmailMessage;
};

export type ListDraftsResponse = {
  drafts?: GmailDraft[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
};

export type BatchModifyResult = {
  responses: unknown[];
};
