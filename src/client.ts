/**
 * GraphQL HTTP client.
 *
 * Wraps a fetch-based POST against a GraphQL endpoint. Supports:
 *   - Custom HTTP headers (e.g. X-API-Key)
 *   - Bearer tokens (Authorization: Bearer <token>)
 *   - Basic auth (username:password)
 *   - Configurable request timeout
 *
 * No external GraphQL library is used — we keep the dependency surface
 * minimal and operate at the HTTP layer so the server works against any
 * conformant GraphQL endpoint.
 */

export interface GraphQLClientOptions {
  endpoint: string;
  headers?: Record<string, string>;
  authToken?: string;
  basicAuth?: { username: string; password: string };
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface GraphQLRequest {
  query: string;
  variables?: Record<string, unknown>;
  operationName?: string;
}

export interface GraphQLResponse {
  data?: unknown;
  errors?: Array<{ message: string; path?: Array<string | number>; locations?: Array<{ line: number; column: number }> }>;
  extensions?: Record<string, unknown>;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Format a GraphQL error into a single-line, agent-friendly message.
 * Includes the error message plus path and location if present.
 */
function formatGraphQLError(err: { message: string; path?: Array<string | number>; locations?: Array<{ line: number; column: number }> }): string {
  const parts: string[] = [err.message];
  if (err.path && err.path.length) {
    parts.push(`at ${err.path.join(".")}`);
  }
  if (err.locations && err.locations.length) {
    const loc = err.locations[0];
    parts.push(`(line ${loc.line}, col ${loc.column})`);
  }
  return parts.join(" ");
}

export class GraphQLClient {
  readonly endpoint: string;
  private headers: Record<string, string>;
  private authToken?: string;
  private basicAuth?: { username: string; password: string };
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(options: GraphQLClientOptions) {
    this.endpoint = options.endpoint;
    this.headers = options.headers ? { ...options.headers } : {};
    this.authToken = options.authToken;
    this.basicAuth = options.basicAuth;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Build the full set of HTTP headers for a request.
   * Custom headers are always sent; auth headers are layered on top.
   */
  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...this.headers,
    };
    if (this.basicAuth) {
      const encoded = Buffer.from(`${this.basicAuth.username}:${this.basicAuth.password}`).toString("base64");
      headers["Authorization"] = `Basic ${encoded}`;
    } else if (this.authToken) {
      headers["Authorization"] = `Bearer ${this.authToken}`;
    }
    return headers;
  }

  /**
   * Set or replace a single header value.
   */
  setHeader(key: string, value: string): void {
    this.headers[key] = value;
  }

  /**
   * Remove a header.
   */
  removeHeader(key: string): void {
    delete this.headers[key];
  }

  /**
   * Replace the full header set.
   */
  setHeaders(headers: Record<string, string>): void {
    this.headers = { ...headers };
  }

  /**
   * Get a copy of current headers (for diagnostics).
   * Sensitive values (auth tokens) are masked.
   */
  getHeadersMasked(): Record<string, string> {
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(this.headers)) {
      masked[k] = v;
    }
    if (this.authToken) {
      masked["Authorization"] = `Bearer ***${this.authToken.slice(-4)}`;
    }
    if (this.basicAuth) {
      masked["Authorization"] = `Basic ***`;
    }
    return masked;
  }

  setAuthToken(token: string | undefined): void {
    this.authToken = token;
  }

  setBasicAuth(basicAuth: { username: string; password: string } | undefined): void {
    this.basicAuth = basicAuth;
  }

  getAuthToken(): string | undefined {
    return this.authToken;
  }

  getBasicAuth(): { username: string; password: string } | undefined {
    return this.basicAuth;
  }

  /**
   * Send a GraphQL operation. Throws on network/transport errors.
   * GraphQL errors (HTTP 200 with `errors` array) are returned, not thrown.
   */
  async execute(request: GraphQLRequest): Promise<GraphQLResponse> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: this.buildHeaders(),
        body: JSON.stringify({
          query: request.query,
          variables: request.variables ?? null,
          operationName: request.operationName ?? null,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // Try to extract an error message from the body
      let body = "";
      try {
        const json = (await response.json()) as { errors?: Array<{ message: string }>; message?: string };
        body = json.errors?.map((e) => e.message).join("; ") || json.message || "";
      } catch {
        try {
          body = await response.text();
        } catch {
          body = "";
        }
      }
      throw new GraphQLHttpError(response.status, response.statusText, body);
    }

    const json = (await response.json()) as GraphQLResponse;
    return json;
  }

  /**
   * Format a GraphQL response (data + errors) into a single string for tool output.
   * If `errors` is present, includes them as a top-level field so the agent can see
   * both the data and the errors.
   */
  static formatResponse(resp: GraphQLResponse): string {
    if (resp.errors && resp.errors.length) {
      const errorMessages = resp.errors.map(formatGraphQLError).join("\n  - ");
      const dataStr = resp.data !== undefined ? `\n\ndata: ${JSON.stringify(resp.data, null, 2)}` : "";
      return `GraphQL returned ${resp.errors.length} error(s):\n  - ${errorMessages}${dataStr}`;
    }
    return JSON.stringify(resp.data ?? null, null, 2);
  }

  /**
   * Probe the endpoint with a trivial introspection ping.
   * Returns true if the endpoint responds with a parseable GraphQL response.
   * Used at startup or for `get_connection_status`.
   */
  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const resp = await this.execute({
        query: "{ __typename }",
      });
      const latencyMs = Date.now() - start;
      if (resp.errors && resp.errors.length) {
        return { ok: false, latencyMs, error: resp.errors.map((e) => e.message).join("; ") };
      }
      return { ok: true, latencyMs };
    } catch (error) {
      return { ok: false, latencyMs: Date.now() - start, error: formatError(error) };
    }
  }
}

export class GraphQLHttpError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly body: string;
  retryable: boolean;
  constructor(status: number, statusText: string, body: string) {
    super(`GraphQL HTTP ${status} ${statusText}${body ? `: ${body.slice(0, 500)}` : ""}`);
    this.name = "GraphQLHttpError";
    this.status = status;
    this.statusText = statusText;
    this.body = body;
    // 5xx and 429 are retryable; 4xx are not.
    this.retryable = status >= 500 || status === 429 || status === 408;
  }
}

export class GraphQLTimeoutError extends Error {
  retryable = true;
  constructor(message: string) {
    super(message);
    this.name = "GraphQLTimeoutError";
  }
}

/**
 * Format any caught error into a string suitable for tool output.
 */
export function formatError(error: unknown): string {
  if (error instanceof GraphQLHttpError) return `${error.name} (${error.status}): ${error.body || error.statusText}`;
  if (error instanceof GraphQLTimeoutError) return `${error.name}: ${error.message}`;
  if (error instanceof Error) {
    // AbortError happens on timeout (when using fetch + AbortController)
    if (error.name === "AbortError") {
      return `GraphQLTimeoutError: Request aborted (likely timeout)`;
    }
    return error.message;
  }
  if (typeof error === "string") return error;
  return String(error);
}

/**
 * Retry a GraphQL request with exponential backoff.
 * Retries on transient errors (network reset, timeout, 5xx, 429).
 * Does NOT retry on 4xx (bad request, not found, permission denied).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; baseDelayMs?: number; label?: string } = {}
): Promise<T> {
  const { maxRetries = 3, baseDelayMs = 500, label = "GraphQL call" } = options;
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryableError(error)) throw error;
      if (attempt === maxRetries) throw error;
      const delay = baseDelayMs * Math.pow(2, attempt);
      process.stderr.write(`[retry] ${label} failed (attempt ${attempt + 1}/${maxRetries + 1}), retrying in ${delay}ms...\n`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastError;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof GraphQLHttpError) return error.retryable;
  if (error instanceof GraphQLTimeoutError) return true;
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  if (msg.includes("econnreset") || msg.includes("econnrefused")) return true;
  if (msg.includes("etimedout") || msg.includes("socket hang up")) return true;
  if (msg.includes("eai_again") || msg.includes("fetch failed")) return true;
  if (error.name === "AbortError") return true; // timeout
  return false;
}

/**
 * Sanitize a string for tool output: strip ANSI escapes and cap length.
 * Prevents prompt-injection via output and caps LLM context cost.
 */
export function sanitizeOutput(text: string, maxLength = 1_000_000): string {
  text = text.replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, "");
  text = text.replace(/\x1b\][^\x07]*\x07/g, "");
  text = text.replace(/\x1b[@-Z\\-_]/g, "");
  text = text.replace(/[\u{E0000}-\u{E007F}\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/gu, "");
  if (text.length > maxLength) {
    return text.slice(0, maxLength) + `\n... [output truncated at ${maxLength} chars]`;
  }
  return text;
}
