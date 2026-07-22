import { messageAction, modifyMessages } from "@/gmail";
import { CliError } from "@/utils";
import { labelsForOrganize, resolveTargets, variadicArguments } from "./helpers";
import type { CommandContext } from "./types";

export async function handleOrganizeCommand(context: CommandContext): Promise<unknown> {
  const { id, args, options, oauthClient } = context;
  const ids = await resolveTargets(variadicArguments(args), options, oauthClient);
  if (id === "messages.trash" || id === "messages.untrash") {
    if (options.dryRun === true) return { ok: true, dryRun: true, matched: ids.length, ids };
    const action = id === "messages.trash" ? "trash" : "untrash";
    const completed: string[] = [];
    for (const messageId of ids) {
      try {
        await messageAction({ id: messageId, action, oauthClient });
        completed.push(messageId);
      } catch (error) {
        throw new CliError(`Gmail ${action} operation failed after partially completing.`, "gmail_partial_failure", {
          action,
          completed: completed.length,
          completedIds: completed,
          failedId: messageId,
          cause: errorMessage(error),
        });
      }
    }
    return { ok: true, [action === "trash" ? "trashed" : "untrashed"]: completed.length, ids: completed };
  }

  const labels = await labelsForOrganize(id, options, oauthClient);
  if (options.dryRun === true) {
    return { ok: true, dryRun: true, matched: ids.length, ids, ...labels };
  }
  const data = await modifyMessages({ ids, ...labels, oauthClient });
  return { ok: true, updated: ids.length, batches: Math.ceil(ids.length / 1000), data };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
