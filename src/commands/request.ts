import { gmailRequest } from "@/gmail";
import { CliError } from "@/utils";
import { argumentAt, readJsonInput } from "./helpers";
import type { CommandContext } from "./types";

export async function handleRequestCommand(context: CommandContext): Promise<unknown> {
  const { args, options, oauthClient } = context;
  const method = (argumentAt(args, 0) ?? options.method ?? "GET").toUpperCase();
  const path = argumentAt(args, 1) ?? options.path;
  if (!path) throw new CliError("Missing request path.", "path_missing");
  return {
    ok: true,
    data: await gmailRequest({
      method,
      path,
      body: await readJsonInput(options),
      oauthClient,
    }),
  };
}
