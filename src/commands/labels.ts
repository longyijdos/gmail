import { CliError, one } from "../cli";
import { createLabel, deleteLabel, listLabels, patchLabel } from "../gmail";
import { resolveLabelId } from "./helpers";
import type { CommandContext } from "./types";

export async function handleLabelCommand(context: CommandContext): Promise<unknown | undefined> {
  const { parsed, command, subcommand, oauthClient } = context;
  if (command === "labels" && (subcommand === "list" || subcommand === undefined)) {
    return { ok: true, data: await listLabels(oauthClient) };
  }
  if (command === "label-create") {
    const name = subcommand ?? one(parsed.flags, "name");
    if (!name) throw new CliError("Missing label name.", "label_name_missing");
    return { ok: true, data: await createLabel({ name, oauthClient }) };
  }
  if (command === "label-delete") {
    const label = subcommand;
    if (!label) throw new CliError("Missing label name or id.", "label_missing");
    const id = await resolveLabelId(label, oauthClient);
    await deleteLabel({ id, oauthClient });
    return { ok: true, deleted: true, id };
  }
  if (command === "label-rename") {
    const label = subcommand;
    const name = one(parsed.flags, "to");
    if (!label || !name) throw new CliError("Usage: gml label-rename <name-or-id> --to <new-name>", "args_invalid");
    const id = await resolveLabelId(label, oauthClient);
    return { ok: true, data: await patchLabel({ id, name, oauthClient }) };
  }
  return undefined;
}
