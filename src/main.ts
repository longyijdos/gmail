#!/usr/bin/env bun
import { runCommand } from "./commands";
import { errorToJson, exitCodeFor, writeJson } from "./cli";

runCommand(process.argv.slice(2))
  .then(writeJson)
  .catch((error) => {
    writeJson(errorToJson(error));
    process.exitCode = exitCodeFor(error);
  });
