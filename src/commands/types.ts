import type { OAuthClient } from "../auth";
import type { ParsedArgs } from "../cli";

export type CommandContext = {
  parsed: ParsedArgs;
  command: string;
  subcommand?: string;
  rest: string[];
  oauthClient?: OAuthClient;
};
