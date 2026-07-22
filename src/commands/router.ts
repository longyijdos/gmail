import { handleAuthCommand } from "./auth";
import { handleLabelCommand } from "./labels";
import { handleOrganizeCommand } from "./organize";
import { handleReadCommand } from "./read";
import { handleRequestCommand } from "./request";
import { handleWriteCommand } from "./write";
import { resolveOAuthClient } from "./helpers";
import type { CommandContext, CommandId, CommandInvocation } from "./types";

const AUTH_COMMANDS = new Set<CommandId>(["auth.login", "auth.status", "auth.logout"]);
const LABEL_COMMANDS = new Set<CommandId>(["labels.list", "labels.create", "labels.delete", "labels.rename"]);
const READ_COMMANDS = new Set<CommandId>([
  "profile",
  "messages.list",
  "messages.get",
  "messages.read",
  "messages.attachments",
  "messages.download",
  "threads.list",
  "threads.get",
]);
const WRITE_COMMANDS = new Set<CommandId>([
  "messages.send",
  "messages.reply",
  "messages.forward",
  "drafts.create",
  "drafts.list",
  "drafts.send",
  "drafts.delete",
]);
const ORGANIZE_COMMANDS = new Set<CommandId>([
  "messages.modify",
  "messages.trash",
  "messages.untrash",
  "messages.mark-read",
  "messages.mark-unread",
  "messages.star",
  "messages.unstar",
  "messages.archive",
  "messages.unarchive",
  "messages.spam",
  "messages.unspam",
]);

export async function runCommand(invocation: CommandInvocation): Promise<unknown> {
  if (AUTH_COMMANDS.has(invocation.id)) return handleAuthCommand(invocation);

  const oauthClient = await resolveOAuthClient(invocation.options, false);
  const context: CommandContext = { ...invocation, oauthClient };
  if (LABEL_COMMANDS.has(invocation.id)) return handleLabelCommand(context);
  if (READ_COMMANDS.has(invocation.id)) return handleReadCommand(context);
  if (WRITE_COMMANDS.has(invocation.id)) return handleWriteCommand(context);
  if (ORGANIZE_COMMANDS.has(invocation.id)) return handleOrganizeCommand(context);
  return handleRequestCommand(context);
}
