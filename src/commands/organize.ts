import { modifyMessages, messageAction } from "../gmail";
import { labelsForOrganize, resolveTargets } from "./helpers";
import type { CommandContext } from "./types";

const MODIFY_COMMANDS = new Set([
  "modify",
  "markread",
  "markunread",
  "star",
  "unstar",
  "archive",
  "unarchive",
  "spam",
  "unspam",
]);

export async function handleOrganizeCommand(context: CommandContext): Promise<unknown | undefined> {
  const { parsed, command, subcommand, rest, oauthClient } = context;
  if (MODIFY_COMMANDS.has(command)) {
    const ids = await resolveTargets(positionals(subcommand, rest), parsed.flags, oauthClient);
    const labels = await labelsForOrganize(command, parsed.flags, oauthClient);
    const data = await modifyMessages({ ids, ...labels, oauthClient });
    return { ok: true, data };
  }
  if (command === "trash" || command === "untrash") {
    const ids = await resolveTargets(positionals(subcommand, rest), parsed.flags, oauthClient);
    const done = [];
    for (const id of ids) {
      await messageAction({ id, action: command, oauthClient });
      done.push(id);
    }
    return { ok: true, [command === "trash" ? "trashed" : "untrashed"]: done.length, ids: done };
  }
  return undefined;
}

function positionals(subcommand: string | undefined, rest: string[]): string[] {
  return subcommand === undefined ? rest : [subcommand, ...rest];
}
