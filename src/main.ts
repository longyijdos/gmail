#!/usr/bin/env node
import { executeCommand } from "@/app";
import { exitCodeFor, writeCommandError, writeCommandOutput } from "@/cli";
import { configureProxyFromEnvironment } from "@/utils";

configureProxyFromEnvironment();
const outcome = await executeCommand(process.argv.slice(2));

if (outcome.ok) {
  if (outcome.invocation !== undefined) writeCommandOutput(outcome.value, outcome.invocation);
} else {
  writeCommandError(outcome.error, outcome.invocation);
  process.exitCode = exitCodeFor(outcome.error);
}
