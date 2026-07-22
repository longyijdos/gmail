import { parseArgs } from "../cli/args";
import { CliError } from "../errors";
import { handleAuthCommand } from "./auth";
import { handleLabelCommand } from "./labels";
import { handleOrganizeCommand } from "./organize";
import { handleReadCommand } from "./read";
import { handleRequestCommand } from "./request";
import { handleWriteCommand } from "./write";
import { resolveOAuthClient } from "./helpers";
import type { CommandContext } from "./types";

const ORGANIZE_COMMANDS = new Set([
  "modify",
  "markread",
  "markunread",
  "star",
  "unstar",
  "archive",
  "unarchive",
  "spam",
  "unspam",
  "trash",
  "untrash",
]);

export async function runCommand(argv: string[]): Promise<unknown> {
  const parsed = parseArgs(argv);
  const [command, subcommand, ...rest] = parsed.positionals;
  if (command === undefined) throw new CliError("Missing command.", "command_missing");

  if (command === "auth") {
    const response = await handleAuthCommand({ parsed, command, subcommand, rest });
    if (response !== undefined) return response;
  }

  const oauthClient = await resolveOAuthClient(parsed.flags, { required: false });
  const context: CommandContext = { parsed, command, subcommand, rest, oauthClient };

  const response =
    (await handleReadCommand(context)) ??
    (await handleLabelCommand(context)) ??
    (await handleWriteCommand(context)) ??
    (await handleOrganizeCommand(context)) ??
    (await handleRequestCommand(context));

  if (response !== undefined) return response;
  if (ORGANIZE_COMMANDS.has(command)) {
    throw new CliError(`Unknown organize command: ${command}`, "command_unknown");
  }
  throw new CliError(`Unknown command: ${[command, subcommand].filter(Boolean).join(" ")}`, "command_unknown");
}
