export type JsonObject = Record<string, unknown>;

export class CliError extends Error {
  constructor(
    message: string,
    public readonly code = "error",
    public readonly details?: JsonObject,
    public readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export function writeJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

export function errorToJson(error: unknown): JsonObject {
  if (error instanceof CliError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details }),
      },
    };
  }
  if (error instanceof Error) {
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: error.message,
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "internal_error",
      message: String(error),
    },
  };
}

export function exitCodeFor(error: unknown): number {
  return error instanceof CliError ? error.exitCode : 1;
}
