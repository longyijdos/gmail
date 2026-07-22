export type ErrorDetails = Record<string, unknown>;

export class CliError extends Error {
  constructor(
    message: string,
    public readonly code = "error",
    public readonly details?: ErrorDetails,
    public readonly exitCode = 1,
  ) {
    super(message);
    this.name = "CliError";
  }
}
