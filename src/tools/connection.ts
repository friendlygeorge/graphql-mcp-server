/**
 * Connection & configuration tools.
 *
 * Tools for setting up and inspecting the active GraphQL endpoint,
 * authentication, and HTTP headers. These are the first tools the agent
 * calls in a session.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GraphQLClient, formatError } from "../client.js";
import type { ServerContext } from "../context.js";
import {
  AddHeaderSchema,
  ClearCacheSchema,
  ConnectEndpointSchema,
  GetConnectionStatusSchema,
  RemoveHeaderSchema,
  SetAuthTokenSchema,
  SetBasicAuthSchema,
  SetHeadersSchema,
} from "../types.js";
import { INTROSPECTION_QUERY, SchemaCache } from "../schema.js";

export function registerConnectionTools(server: McpServer, ctx: ServerContext): void {
  // -----------------------------------------------------------------------
  // connect_endpoint
  // -----------------------------------------------------------------------
  server.tool(
    "connect_endpoint",
    "Set or change the active GraphQL endpoint. All subsequent tool calls (introspect, query, mutate) target this endpoint. Replaces the previous client; existing schema cache for the old endpoint is kept but a new schema will be fetched for the new one. Use set_auth_token / set_headers immediately after to configure credentials. If the endpoint requires CORS for browser access, that is the caller's responsibility — the MCP server is a backend process.",
    ConnectEndpointSchema.shape,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async (params) => {
      try {
        ctx.configure({ endpoint: params.endpoint, timeoutMs: params.timeout_ms });
        return {
          content: [{ type: "text", text: `Connected to ${params.endpoint}. Call introspect_schema to load the schema, or list_queries / list_types to explore it.` }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // set_auth_token
  // -----------------------------------------------------------------------
  server.tool(
    "set_auth_token",
    "Set a bearer token to send in the Authorization header on every request. Pass an empty string to clear. The token is held in process memory and never logged. For Basic auth or arbitrary headers, use set_basic_auth or set_headers / add_header instead.",
    SetAuthTokenSchema.shape,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        if (!ctx.isConfigured()) {
          return { content: [{ type: "text", text: "Error: No endpoint configured. Call connect_endpoint first." }], isError: true };
        }
        const client = ctx.getClient();
        if (params.token === "") {
          client.setAuthToken(undefined);
          return { content: [{ type: "text", text: "Bearer token cleared." }] };
        }
        client.setAuthToken(params.token);
        return { content: [{ type: "text", text: `Bearer token set (***${params.token.slice(-4)}).` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // set_basic_auth
  // -----------------------------------------------------------------------
  server.tool(
    "set_basic_auth",
    "Configure HTTP Basic authentication. Replaces any bearer token. Pass empty username + password to clear.",
    SetBasicAuthSchema.shape,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        if (!ctx.isConfigured()) {
          return { content: [{ type: "text", text: "Error: No endpoint configured. Call connect_endpoint first." }], isError: true };
        }
        const client = ctx.getClient();
        if (params.username === "" && params.password === "") {
          client.setBasicAuth(undefined);
          return { content: [{ type: "text", text: "Basic auth cleared." }] };
        }
        client.setBasicAuth({ username: params.username, password: params.password });
        return { content: [{ type: "text", text: `Basic auth configured for user '${params.username}'.` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // set_headers
  // -----------------------------------------------------------------------
  server.tool(
    "set_headers",
    "Replace the full set of custom HTTP headers. Use this for X-API-Key, X-Tenant, X-Trace-Id, etc. Authorization is handled separately by set_auth_token / set_basic_auth and will be re-applied on top of these headers. Pass an empty object to clear all custom headers.",
    SetHeadersSchema.shape,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        if (!ctx.isConfigured()) {
          return { content: [{ type: "text", text: "Error: No endpoint configured. Call connect_endpoint first." }], isError: true };
        }
        const client = ctx.getClient();
        client.setHeaders(params.headers);
        return { content: [{ type: "text", text: `Set ${Object.keys(params.headers).length} header(s).` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // add_header
  // -----------------------------------------------------------------------
  server.tool(
    "add_header",
    "Add or update a single custom HTTP header without replacing the others. Useful for one-off headers like X-Trace-Id. To remove, use remove_header.",
    AddHeaderSchema.shape,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        if (!ctx.isConfigured()) {
          return { content: [{ type: "text", text: "Error: No endpoint configured. Call connect_endpoint first." }], isError: true };
        }
        const client = ctx.getClient();
        client.setHeader(params.key, params.value);
        return { content: [{ type: "text", text: `Header '${params.key}' set.` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // remove_header
  // -----------------------------------------------------------------------
  server.tool(
    "remove_header",
    "Remove a custom HTTP header. Does not affect Authorization (use set_auth_token with empty string).",
    RemoveHeaderSchema.shape,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        if (!ctx.isConfigured()) {
          return { content: [{ type: "text", text: "Error: No endpoint configured. Call connect_endpoint first." }], isError: true };
        }
        const client = ctx.getClient();
        client.removeHeader(params.key);
        return { content: [{ type: "text", text: `Header '${params.key}' removed.` }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // get_connection_status
  // -----------------------------------------------------------------------
  server.tool(
    "get_connection_status",
    "Show the current endpoint, configured headers (with secrets masked), auth state, and schema cache state. Set ping=true to also send a {__typename} query to verify the endpoint is reachable and measure latency.",
    GetConnectionStatusSchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async (params) => {
      try {
        if (!ctx.isConfigured()) {
          const summary = {
            configured: false,
            hint: "Call connect_endpoint with a URL, or set GRAPHQL_ENDPOINT env var.",
          };
          return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
        }
        const client = ctx.getClient();
        const endpoint = ctx.getEndpoint();
        const maskedHeaders = client.getHeadersMasked();
        const cached = endpoint ? ctx.cache.get(endpoint) : null;

        const summary: Record<string, unknown> = {
          configured: true,
          endpoint,
          auth: client.getAuthToken()
            ? `bearer (***${client.getAuthToken()!.slice(-4)})`
            : client.getBasicAuth()
              ? `basic (user: ${client.getBasicAuth()!.username})`
              : "none",
          headers: maskedHeaders,
          schema_cached: cached !== null,
        };
        if (cached) {
          const fetchedAt = ctx.cache.getFetchedAt(endpoint!);
          summary.schema_fetched_at = fetchedAt;
          summary.type_count = cached.types.length;
          summary.query_count = cached.queryType ? (cached.types.find((t) => t.name === cached.queryType!.name)?.fields?.length ?? 0) : 0;
          summary.mutation_count = cached.mutationType ? (cached.types.find((t) => t.name === cached.mutationType!.name)?.fields?.length ?? 0) : 0;
        }
        if (params.ping) {
          const pingResult = await client.ping();
          summary.ping = pingResult;
        }
        return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );
}
