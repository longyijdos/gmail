import type { OAuthClient } from "@/auth";

export type CommandId =
  | "auth.login"
  | "auth.status"
  | "auth.logout"
  | "profile"
  | "labels.list"
  | "labels.create"
  | "labels.delete"
  | "labels.rename"
  | "messages.list"
  | "messages.get"
  | "messages.read"
  | "messages.attachments"
  | "messages.download"
  | "messages.send"
  | "messages.reply"
  | "messages.forward"
  | "threads.list"
  | "threads.get"
  | "drafts.create"
  | "drafts.list"
  | "drafts.send"
  | "drafts.delete"
  | "messages.modify"
  | "messages.trash"
  | "messages.untrash"
  | "messages.mark-read"
  | "messages.mark-unread"
  | "messages.star"
  | "messages.unstar"
  | "messages.archive"
  | "messages.unarchive"
  | "messages.spam"
  | "messages.unspam"
  | "request";

export type CommandArgument = string | string[] | undefined;

export type CommandOptions = {
  add?: string[];
  all?: boolean;
  attach?: string[];
  attachment?: string;
  attachments?: boolean;
  bcc?: string[];
  body?: string;
  bodyFile?: string;
  cc?: string[];
  clientId?: string;
  clientSecret?: string;
  clientSecretFile?: string;
  dryRun?: boolean;
  force?: boolean;
  format?: string;
  from?: string;
  html?: boolean;
  id?: string;
  includeSpamTrash?: boolean;
  json?: boolean;
  label?: string[];
  labelId?: string[];
  maxResults?: number;
  metadataHeader?: string[];
  method?: string;
  name?: string;
  open?: boolean;
  out?: string;
  pageToken?: string;
  path?: string;
  q?: string;
  query?: string;
  raw?: boolean;
  remove?: string[];
  scope?: string[];
  subject?: string;
  text?: string;
  to?: string | string[];
};

export type CommandInvocation = {
  id: CommandId;
  args: CommandArgument[];
  options: CommandOptions;
};

export type CommandContext = CommandInvocation & {
  oauthClient?: OAuthClient;
};
