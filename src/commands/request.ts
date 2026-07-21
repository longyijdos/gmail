import { CliError, one, readJsonFlag } from "../cli";
import { gmailRequest } from "../gmail";
import type { CommandContext } from "./types";

export async function handleRequestCommand(context: CommandContext): Promise<unknown | undefined> {
  const { parsed, command, subcommand, rest, oauthClient } = context;
  if (command !== "request") return undefined;
  const method = (subcommand ?? one(parsed.flags, "method") ?? "GET").toUpperCase();
  const path = rest[0] ?? one(parsed.flags, "path");
  if (!path) throw new CliError("Missing request path.", "path_missing");
  return {
    ok: true,
    data: await gmailRequest({
      method,
      path,
      body: await readJsonFlag(parsed.flags, "body"),
      oauthClient,
    }),
  };
}
