#!/usr/bin/env bun
import { errorToJson, executeCommand, exitCodeFor, writeJson } from "./cli";

executeCommand(process.argv.slice(2))
  .then((result) => {
    if (result !== undefined) writeJson(result);
  })
  .catch((error) => {
    writeJson(errorToJson(error));
    process.exitCode = exitCodeFor(error);
  });
