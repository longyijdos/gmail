export class HttpTimeoutError extends Error {
  constructor(
    public readonly timeoutMs: number,
    public readonly url: string,
  ) {
    super(`Request timed out after ${timeoutMs} ms.`);
    this.name = "HttpTimeoutError";
  }
}

export class HttpNetworkError extends Error {
  constructor(
    public readonly url: string,
    public override readonly cause: unknown,
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = "HttpNetworkError";
  }
}

export async function fetchText(
  input: string | URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; text: string }> {
  const url = input.toString();
  const controller = new AbortController();
  const effectiveTimeoutMs = Number.isFinite(timeoutMs) ? Math.max(1, timeoutMs) : 1;
  const timer = setTimeout(() => controller.abort(), effectiveTimeoutMs);
  try {
    const response = await fetch(input, { ...init, signal: controller.signal });
    return { response, text: await response.text() };
  } catch (error) {
    if (controller.signal.aborted) throw new HttpTimeoutError(effectiveTimeoutMs, url);
    throw new HttpNetworkError(url, error);
  } finally {
    clearTimeout(timer);
  }
}
