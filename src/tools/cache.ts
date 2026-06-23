/**
 * Schema cache management tools.
 *
 * Tools for inspecting, clearing, and refreshing the in-memory schema cache.
 * The cache is keyed by endpoint URL — multiple endpoints can be cached
 * simultaneously if the agent switches between them.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatError } from "../client.js";
import type { ServerContext } from "../context.js";
import {
  ClearCacheSchema,
  GetCachedSchemaSchema,
  ReloadSchemaSchema,
} from "../types.js";
import {
  isSystemType,
  printTypeRef,
  type IntrospectionType,
} from "../schema.js";

/** Convert a type to a compact JSON-serialisable object with bounded depth. */
function summariseTypeCompact(t: IntrospectionType, includeSystem: boolean, depth: number, maxDepth: number): Record<string, unknown> {
  if (depth > maxDepth) {
    return { name: t.name, kind: t.kind, truncated: true };
  }
  const out: Record<string, unknown> = {
    kind: t.kind,
    name: t.name,
  };
  if (t.description) out.description = t.description;
  if (t.fields && t.fields.length) {
    out.fields = t.fields.map((f) => ({
      name: f.name,
      type: printTypeRef(f.type),
      description: f.description ?? undefined,
      args: f.args.map((a) => ({ name: a.name, type: printTypeRef(a.type) })),
      is_deprecated: f.isDeprecated || undefined,
    }));
  }
  if (t.inputFields && t.inputFields.length) {
    out.input_fields = t.inputFields.map((f) => ({
      name: f.name,
      type: printTypeRef(f.type),
    }));
  }
  if (t.enumValues && t.enumValues.length) {
    out.enum_values = t.enumValues.map((v) => v.name);
  }
  if (t.interfaces && t.interfaces.length) {
    out.interfaces = t.interfaces.map((i) => i.name).filter(Boolean);
  }
  if (t.possibleTypes && t.possibleTypes.length) {
    out.possible_types = t.possibleTypes.map((i) => i.name).filter(Boolean);
  }
  return out;
}

export function registerCacheTools(server: McpServer, ctx: ServerContext): void {
  // -----------------------------------------------------------------------
  // get_cached_schema
  // -----------------------------------------------------------------------
  server.tool(
    "get_cached_schema",
    "Return the cached introspection result for the current endpoint as JSON. Use this when you need the full schema in one shot (e.g. to build a query offline). For large schemas this can be 1MB+ — use describe_type / list_queries / search_schema for targeted access. The max_depth parameter caps type traversal to keep output size bounded.",
    GetCachedSchemaSchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        const endpoint = ctx.getEndpoint();
        if (!endpoint || !ctx.cache.has(endpoint)) {
          return {
            content: [{ type: "text", text: "No schema cached for the current endpoint. Call introspect_schema first." }],
            isError: true,
          };
        }
        const schema = ctx.cache.get(endpoint)!;
        const includeSystem = params.include_system_types ?? false;
        const maxDepth = params.max_depth ?? 3;
        const types = includeSystem ? schema.types : schema.types.filter((t) => !isSystemType(t.name));

        const compact = {
          query_type: schema.queryType?.name ?? null,
          mutation_type: schema.mutationType?.name ?? null,
          subscription_type: schema.subscriptionType?.name ?? null,
          fetched_at: ctx.cache.getFetchedAt(endpoint),
          directives: schema.directives.map((d) => ({ name: d.name, locations: d.locations })),
          types: types.map((t) => summariseTypeCompact(t, includeSystem, 0, maxDepth)),
        };
        return { content: [{ type: "text", text: JSON.stringify(compact, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // clear_cache
  // -----------------------------------------------------------------------
  server.tool(
    "clear_cache",
    "Clear the schema cache. If endpoint is given, clears only that endpoint's cache; otherwise clears all. Use this to free memory after switching endpoints, or to force a fresh introspection on the next call.",
    ClearCacheSchema.shape,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        const removed = ctx.clearCache(params.endpoint);
        return {
          content: [{
            type: "text",
            text: params.endpoint
              ? `Cleared cache for ${params.endpoint}.`
              : `Cleared cache. Removed ${removed} schema(s).`,
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // reload_schema
  // -----------------------------------------------------------------------
  server.tool(
    "reload_schema",
    "Force a fresh introspection, replacing any cached schema for the given endpoint (or the current one if not specified). Use this when you suspect the remote schema has changed.",
    ReloadSchemaSchema.shape,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    async (params) => {
      try {
        // If a different endpoint is given, we can't reload it without reconfiguring.
        // For now, only reload the current endpoint.
        const current = ctx.getEndpoint();
        if (!current) {
          return { content: [{ type: "text", text: "Error: No endpoint configured. Call connect_endpoint first." }], isError: true };
        }
        if (params.endpoint && params.endpoint !== current) {
          return {
            content: [{ type: "text", text: `Error: reload_schema only works on the current endpoint (${current}). To switch endpoints, use connect_endpoint.` }],
            isError: true,
          };
        }
        const schema = await ctx.getSchema(true);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              reloaded: true,
              type_count: schema.types.length,
              query_type: schema.queryType?.name ?? null,
              mutation_type: schema.mutationType?.name ?? null,
              subscription_type: schema.subscriptionType?.name ?? null,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );
}
