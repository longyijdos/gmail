import { createLabel, deleteLabel, listLabels, patchLabel } from "@/gmail";
import { CliError } from "@/utils";
import { argumentAt, resolveLabelId } from "./helpers";
import type { CommandContext } from "./types";

export async function handleLabelCommand(context: CommandContext): Promise<unknown> {
  const { id, args, options, oauthClient } = context;
  if (id === "labels.list") return { ok: true, data: await listLabels(oauthClient) };
  if (id === "labels.create") {
    const name = argumentAt(args, 0) ?? options.name;
    if (!name) throw new CliError("Missing label name.", "label_name_missing");
    return { ok: true, data: await createLabel({ name, oauthClient }) };
  }
  const label = argumentAt(args, 0);
  if (!label) throw new CliError("Missing label name or id.", "label_missing");
  const labelId = await resolveLabelId(label, oauthClient);
  if (id === "labels.delete") {
    await deleteLabel({ id: labelId, oauthClient });
    return { ok: true, deleted: true, id: labelId };
  }
  const name = typeof options.to === "string" ? options.to : undefined;
  if (!name) throw new CliError("Missing --to.", "args_invalid");
  return { ok: true, data: await patchLabel({ id: labelId, name, oauthClient }) };
}
