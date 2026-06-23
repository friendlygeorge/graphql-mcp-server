/**
 * Shared server state.
 *
 * The MCP server is long-lived (one process per client), so we hold the
 * active GraphQL client and the introspection cache in module-level state.
 *
 * On startup, the endpoint is read from GRAPHQL_ENDPOINT (env). If unset,
 * the server starts in "unconfigured" mode — the agent must call
 * `connect_endpoint` to set one before any other tools work.
 */

import { GraphQLClient, type GraphQLClientOptions } from "./client.js";
import { INTROSPECTION_QUERY, type IntrospectionResponse, type IntrospectionSchema, SchemaCache } from "./schema.js";

export interface ServerContextOptions {
  endpoint?: string;
  headers?: Record<string, string>;
  authToken?: string;
  basicAuth?: { username: string; password: string };
  timeoutMs?: number;
}

export class ServerContext {
  private client: GraphQLClient | null = null;
  private configuredEndpoint: string | null = null;
  readonly cache = new SchemaCache();

  /** Set or replace the active endpoint. Clears any client state. */
  configure(options: ServerContextOptions): GraphQLClient {
    if (options.endpoint) {
      this.configuredEndpoint = options.endpoint;
    }
    if (!this.configuredEndpoint) {
      throw new Error("No endpoint configured. Call connect_endpoint first or set GRAPHQL_ENDPOINT env var.");
    }
    const clientOptions: GraphQLClientOptions = {
      endpoint: this.configuredEndpoint,
      headers: options.headers,
      authToken: options.authToken,
      basicAuth: options.basicAuth,
      timeoutMs: options.timeoutMs,
    };
    this.client = new GraphQLClient(clientOptions);
    return this.client;
  }

  /** Get the current client. Throws if no endpoint is configured. */
  getClient(): GraphQLClient {
    if (!this.client) {
      throw new Error("No GraphQL endpoint configured. Call connect_endpoint first or set GRAPHQL_ENDPOINT env var.");
    }
    return this.client;
  }

  /** Try to get the current client without throwing. Returns null if unconfigured. */
  tryGetClient(): GraphQLClient | null {
    return this.client;
  }

  getEndpoint(): string | null {
    return this.configuredEndpoint;
  }

  isConfigured(): boolean {
    return this.client !== null;
  }

  /**
   * Fetch the schema for the current endpoint.
   * If `force` is false and the cache has a result, returns the cached one.
   * If `force` is true, re-fetches even if cached.
   */
  async getSchema(force = false): Promise<IntrospectionSchema> {
    const client = this.getClient();
    const endpoint = this.getEndpoint();
    if (!endpoint) throw new Error("No endpoint configured");

    if (!force && this.cache.has(endpoint)) {
      const cached = this.cache.get(endpoint);
      if (cached) return cached;
    }

    const resp = await client.execute({ query: INTROSPECTION_QUERY });
    if (resp.errors && resp.errors.length) {
      const msgs = resp.errors.map((e) => e.message).join("; ");
      throw new Error(`Introspection failed: ${msgs}`);
    }
    const data = resp.data as IntrospectionResponse | undefined;
    if (!data?.__schema) {
      throw new Error("Introspection response missing __schema");
    }
    this.cache.set(endpoint, data.__schema);
    return data.__schema;
  }

  /** Clear cache for the current endpoint (or all). */
  clearCache(endpoint?: string): number {
    const before = this.cache.list().length;
    this.cache.clear(endpoint);
    const after = this.cache.list().length;
    return before - after;
  }
}

/**
 * Read connection config from environment variables.
 * Recognised variables:
 *   GRAPHQL_ENDPOINT      — endpoint URL
 *   GRAPHQL_AUTH_TOKEN    — bearer token
 *   GRAPHQL_BASIC_USER    — basic auth username
 *   GRAPHQL_BASIC_PASS    — basic auth password
 *   GRAPHQL_TIMEOUT_MS    — request timeout in ms
 *   GRAPHQL_HEADER_*      — arbitrary headers (e.g. GRAPHQL_HEADER_X_API_KEY=abc)
 */
export function configFromEnv(): ServerContextOptions {
  const env = process.env;
  const headers: Record<string, string> = {};

  for (const [k, v] of Object.entries(env)) {
    if (k.startsWith("GRAPHQL_HEADER_") && typeof v === "string") {
      const headerName = k.slice("GRAPHQL_HEADER_".length).replace(/_/g, "-");
      headers[headerName] = v;
    }
  }

  const options: ServerContextOptions = {
    endpoint: env.GRAPHQL_ENDPOINT || undefined,
    headers: Object.keys(headers).length ? headers : undefined,
    authToken: env.GRAPHQL_AUTH_TOKEN || undefined,
    timeoutMs: env.GRAPHQL_TIMEOUT_MS ? Number(env.GRAPHQL_TIMEOUT_MS) : undefined,
  };

  if (env.GRAPHQL_BASIC_USER && env.GRAPHQL_BASIC_PASS) {
    options.basicAuth = {
      username: env.GRAPHQL_BASIC_USER,
      password: env.GRAPHQL_BASIC_PASS,
    };
  }

  return options;
}
