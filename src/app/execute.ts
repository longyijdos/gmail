import { CommanderError } from "commander";
import { buildProgram } from "@/cli";
import { runCommand } from "@/commands";
import { CliError } from "@/utils";

export async function executeCommand(argv: string[]): Promise<unknown | undefined> {
  let result: unknown | undefined;
  const run = async () => {
    result = await runCommand(argv);
  };
  const program = buildProgram(run);

  try {
    await program.parseAsync(argv, { from: "user" });
    return result;
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.help" ||
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version"
      ) {
        return undefined;
      }
      throw new CliError(error.message, "args_invalid", undefined, error.exitCode);
    }
    throw error;
  }
}
