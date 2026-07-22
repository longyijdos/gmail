import { CommanderError } from "commander";
import packageJson from "../../package.json" with { type: "json" };
import { buildProgram } from "@/cli";
import { runCommand, type CommandInvocation } from "@/commands";
import { CliError } from "@/utils";

export type ExecutionOutcome =
  | { ok: true; invocation?: CommandInvocation; value?: unknown }
  | { ok: false; error: unknown; invocation?: CommandInvocation };

export async function executeCommand(argv: string[]): Promise<ExecutionOutcome> {
  let invocation: CommandInvocation | undefined;
  let value: unknown;
  const run = async (current: CommandInvocation) => {
    invocation = current;
    value = await runCommand(current);
  };
  const program = buildProgram(run, packageJson.version);

  try {
    await program.parseAsync(argv, { from: "user" });
    return invocation === undefined ? { ok: true } : { ok: true, invocation, value };
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.help" ||
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version"
      ) {
        return { ok: true };
      }
      return {
        ok: false,
        error: new CliError(error.message, "args_invalid", undefined, error.exitCode),
        ...(invocation === undefined ? {} : { invocation }),
      };
    }
    return { ok: false, error, ...(invocation === undefined ? {} : { invocation }) };
  }
}
