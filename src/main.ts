#!/usr/bin/env bun
import { exitCodeFor, writeCommandError, writeCommandOutput } from "./cli";
import { executeCommand } from "./execute";

const argv = process.argv.slice(2);

executeCommand(argv)
  .then((result) => {
    if (result !== undefined) writeCommandOutput(result, argv);
  })
  .catch((error) => {
    writeCommandError(error, argv);
    process.exitCode = exitCodeFor(error);
  });
