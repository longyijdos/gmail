import { readFile } from "node:fs/promises";
import { CliError } from "../errors";

export type ParsedArgs = {
  positionals: string[];
  flags: Record<string, string[]>;
};

export function parseArgs(argv: string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string[]> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]!;
    if (arg === "--") {
      positionals.push(...argv.slice(index + 1));
      break;
    }
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (!name) throw new CliError("Flag name cannot be empty.", "args_invalid");
    const value =
      eq === -1 ? readFlagValue(argv, index) : { value: arg.slice(eq + 1), consumed: false };
    if (value.consumed) index += 1;
    (flags[name] ??= []).push(value.value);
  }
  return { positionals, flags };
}

export function one(flags: Record<string, string[]>, name: string): string | undefined {
  const values = flags[name];
  if (values === undefined) return undefined;
  if (values.length > 1) throw new CliError(`--${name} can only be provided once.`, "args_invalid");
  return values[0];
}

export function many(flags: Record<string, string[]>, name: string): string[] {
  return flags[name] ?? [];
}

export function bool(flags: Record<string, string[]>, name: string): string | undefined {
  const value = one(flags, name);
  if (value === undefined) return undefined;
  if (value === "true" || value === "1") return "true";
  if (value === "false" || value === "0") return "false";
  throw new CliError(`--${name} must be true or false.`, "args_invalid");
}

export async function readJsonFlag(flags: Record<string, string[]>, name: string): Promise<unknown> {
  const value = one(flags, name);
  const file = one(flags, `${name}-file`);
  if (value !== undefined && file !== undefined) {
    throw new CliError(`Use either --${name} or --${name}-file, not both.`, "args_invalid");
  }
  if (file !== undefined) return JSON.parse(await readFile(file, "utf8"));
  if (value !== undefined) return JSON.parse(value);
  return undefined;
}

function readFlagValue(argv: string[], index: number): { value: string; consumed: boolean } {
  const next = argv[index + 1];
  if (next === undefined || next.startsWith("--")) return { value: "true", consumed: false };
  return { value: next, consumed: true };
}
