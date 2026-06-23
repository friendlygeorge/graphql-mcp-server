/**
 * Schema introspection & discovery tools.
 *
 * Tools for fetching and exploring the GraphQL schema. Once a schema is
 * introspected, the agent can list types, describe any type, list
 * queries/mutations/subscriptions, describe any field, and search across
 * the schema.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatError } from "../client.js";
import type { ServerContext } from "../context.js";
import {
  DescribeFieldSchema,
  DescribeTypeSchema,
  IntrospectSchemaSchema,
  ListMutationsSchema,
  ListQueriesSchema,
  ListSubscriptionsSchema,
  ListTypesSchema,
  SearchSchemaSchema,
} from "../types.js";
import {
  getMutationType,
  getQueryType,
  getSubscriptionType,
  getType,
  isSystemType,
  listUserTypes,
  printTypeRef,
  searchSchema,
  type IntrospectionField,
  type IntrospectionType,
} from "../schema.js";

/** Build a compact, agent-friendly summary of a type. */
function summariseType(t: IntrospectionType): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    name: t.name,
    kind: t.kind,
    description: t.description,
  };
  if (t.fields) summary.field_count = t.fields.length;
  if (t.inputFields) summary.input_field_count = t.inputFields.length;
  if (t.enumValues) summary.enum_value_count = t.enumValues.length;
  if (t.interfaces && t.interfaces.length) {
    summary.interfaces = t.interfaces
      .map((i) => i.name)
      .filter((n): n is string => Boolean(n));
  }
  if (t.possibleTypes && t.possibleTypes.length) {
    summary.possible_types = t.possibleTypes
      .map((i) => i.name)
      .filter((n): n is string => Boolean(n));
  }
  return summary;
}

/** Build a compact, agent-friendly summary of a field. */
function summariseField(f: IntrospectionField): Record<string, unknown> {
  return {
    name: f.name,
    description: f.description,
    type: printTypeRef(f.type),
    args: f.args.map((a) => ({
      name: a.name,
      type: printTypeRef(a.type),
      description: a.description,
      default_value: a.defaultValue,
    })),
    is_deprecated: f.isDeprecated,
    deprecation_reason: f.deprecationReason,
  };
}

export function registerSchemaTools(server: McpServer, ctx: ServerContext): void {
  // -----------------------------------------------------------------------
  // introspect_schema
  // -----------------------------------------------------------------------
  server.tool(
    "introspect_schema",
    "Fetch the full GraphQL schema via introspection and cache it. Required before any list_*, describe_*, or execute_typed_* call. Idempotent: returns the cached schema if available unless force=true. The schema can be large (>1MB for Shopify/GitHub) so consider clearing the cache or using search/describe tools on subsequent calls.",
    IntrospectSchemaSchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async (params) => {
      try {
        const force = params.force ?? false;
        if (!force) {
          const endpoint = ctx.getEndpoint();
          if (endpoint && ctx.cache.has(endpoint)) {
            const cached = ctx.cache.get(endpoint)!;
            return {
              content: [{
                type: "text",
                text: JSON.stringify({
                  source: "cache",
                  fetched_at: ctx.cache.getFetchedAt(endpoint),
                  type_count: cached.types.length,
                  query_type: cached.queryType?.name ?? null,
                  mutation_type: cached.mutationType?.name ?? null,
                  subscription_type: cached.subscriptionType?.name ?? null,
                  directive_count: cached.directives.length,
                }, null, 2),
              }],
            };
          }
        }
        const schema = await ctx.getSchema(force);
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              source: "introspection",
              type_count: schema.types.length,
              query_type: schema.queryType?.name ?? null,
              mutation_type: schema.mutationType?.name ?? null,
              subscription_type: schema.subscriptionType?.name ?? null,
              directive_count: schema.directives.length,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // list_types
  // -----------------------------------------------------------------------
  server.tool(
    "list_types",
    "List all types in the introspected schema. Filter by kind (OBJECT, SCALAR, INTERFACE, UNION, ENUM, INPUT_OBJECT) or by name substring. Excludes introspection system types (those starting with __) by default. Use describe_type to get full details for a specific type.",
    ListTypesSchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        const schema = await ctx.getSchema();
        let types = listUserTypes(schema);
        if (params.kind && params.kind !== "ALL") {
          types = types.filter((t) => t.kind === params.kind);
        }
        if (params.search) {
          const needle = params.search.toLowerCase();
          types = types.filter((t) => t.name.toLowerCase().includes(needle));
        }
        const limit = params.limit ?? 200;
        const truncated = types.length > limit;
        const sliced = truncated ? types.slice(0, limit) : types;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: types.length,
              returned: sliced.length,
              truncated,
              types: sliced.map(summariseType),
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // describe_type
  // -----------------------------------------------------------------------
  server.tool(
    "describe_type",
    "Get full details of a single type: all fields (with their args and return types), input fields, interfaces, enum values, and possible types. Use this to understand a type's shape before constructing a query. Pass the name of any type — including root types like 'Query' or 'Mutation', input types like 'CreateUserInput', or scalar types.",
    DescribeTypeSchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        const schema = await ctx.getSchema();
        const type = getType(schema, params.type_name);
        if (!type) {
          return {
            content: [{ type: "text", text: `Type '${params.type_name}' not found. Use list_types to see available types.` }],
            isError: true,
          };
        }
        const includeDeprecated = params.include_deprecated ?? true;
        const result: Record<string, unknown> = {
          name: type.name,
          kind: type.kind,
          description: type.description,
        };
        if (type.fields) {
          let fields = type.fields;
          if (!includeDeprecated) fields = fields.filter((f) => !f.isDeprecated);
          result.fields = fields.map(summariseField);
        }
        if (type.inputFields) {
          result.input_fields = type.inputFields.map((f) => ({
            name: f.name,
            type: printTypeRef(f.type),
            description: f.description,
            default_value: f.defaultValue,
          }));
        }
        if (type.interfaces && type.interfaces.length) {
          result.interfaces = type.interfaces.map((i) => i.name).filter(Boolean);
        }
        if (type.enumValues) {
          let values = type.enumValues;
          if (!includeDeprecated) values = values.filter((v) => !v.isDeprecated);
          result.enum_values = values.map((v) => ({
            name: v.name,
            description: v.description,
            is_deprecated: v.isDeprecated,
            deprecation_reason: v.deprecationReason,
          }));
        }
        if (type.possibleTypes && type.possibleTypes.length) {
          result.possible_types = type.possibleTypes.map((i) => i.name).filter(Boolean);
        }
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // list_queries
  // -----------------------------------------------------------------------
  server.tool(
    "list_queries",
    "List all root query fields (e.g. user, posts, search). Each entry shows the field's return type and its argument types. Use describe_field to get more detail on a specific query. Use search= to filter by name substring.",
    ListQueriesSchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        const schema = await ctx.getSchema();
        const queryType = getQueryType(schema);
        if (!queryType) {
          return { content: [{ type: "text", text: "Schema has no Query type." }] };
        }
        let fields = queryType.fields ?? [];
        if (params.search) {
          const needle = params.search.toLowerCase();
          fields = fields.filter((f) => f.name.toLowerCase().includes(needle));
        }
        const limit = params.limit ?? 200;
        const truncated = fields.length > limit;
        const sliced = truncated ? fields.slice(0, limit) : fields;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: fields.length,
              returned: sliced.length,
              truncated,
              queries: sliced.map(summariseField),
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // list_mutations
  // -----------------------------------------------------------------------
  server.tool(
    "list_mutations",
    "List all root mutation fields (e.g. createUser, updatePost). Each entry shows the return type and argument types. Returns an empty list if the schema has no mutation type. Use search= to filter by name.",
    ListMutationsSchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        const schema = await ctx.getSchema();
        const mutationType = getMutationType(schema);
        if (!mutationType) {
          return { content: [{ type: "text", text: "Schema has no Mutation type." }] };
        }
        let fields = mutationType.fields ?? [];
        if (params.search) {
          const needle = params.search.toLowerCase();
          fields = fields.filter((f) => f.name.toLowerCase().includes(needle));
        }
        const limit = params.limit ?? 200;
        const truncated = fields.length > limit;
        const sliced = truncated ? fields.slice(0, limit) : fields;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: fields.length,
              returned: sliced.length,
              truncated,
              mutations: sliced.map(summariseField),
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // list_subscriptions
  // -----------------------------------------------------------------------
  server.tool(
    "list_subscriptions",
    "List all root subscription fields (e.g. messageAdded, onUserUpdate). Note: this MCP server uses HTTP request/response, so subscriptions cannot be executed here — list is informational only. Use a websocket-based GraphQL client to consume subscriptions. Returns an empty list if the schema has no subscription type.",
    ListSubscriptionsSchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        const schema = await ctx.getSchema();
        const subType = getSubscriptionType(schema);
        if (!subType) {
          return { content: [{ type: "text", text: "Schema has no Subscription type." }] };
        }
        let fields = subType.fields ?? [];
        if (params.search) {
          const needle = params.search.toLowerCase();
          fields = fields.filter((f) => f.name.toLowerCase().includes(needle));
        }
        const limit = params.limit ?? 200;
        const truncated = fields.length > limit;
        const sliced = truncated ? fields.slice(0, limit) : fields;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              total: fields.length,
              returned: sliced.length,
              truncated,
              note: "Subscriptions require a WebSocket transport; this server uses HTTP. Listing is informational only.",
              subscriptions: sliced.map(summariseField),
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // describe_field
  // -----------------------------------------------------------------------
  server.tool(
    "describe_field",
    "Get full details of a single field on any type: description, return type, arguments (each with name, type, description, default value), and deprecation info. Pass type_name='Query' or 'Mutation' to look up root operations, or pass any object type name to look up one of its fields.",
    DescribeFieldSchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        const schema = await ctx.getSchema();
        const type = getType(schema, params.type_name);
        if (!type) {
          return {
            content: [{ type: "text", text: `Type '${params.type_name}' not found. Use list_types to see available types.` }],
            isError: true,
          };
        }
        const field = (type.fields ?? []).find((f) => f.name === params.field_name);
        if (!field) {
          return {
            content: [{ type: "text", text: `Field '${params.field_name}' not found on type '${params.type_name}'.` }],
            isError: true,
          };
        }
        return { content: [{ type: "text", text: JSON.stringify(summariseField(field), null, 2) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // search_schema
  // -----------------------------------------------------------------------
  server.tool(
    "search_schema",
    "Search the entire schema for types, fields, input fields, and enum values matching a substring (case-insensitive). Useful for finding things by partial name when the schema is large. Returns up to 100 hits by default.",
    SearchSchemaSchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async (params) => {
      try {
        const schema = await ctx.getSchema();
        const hits = searchSchema(schema, params.term);
        const limit = params.limit ?? 100;
        const truncated = hits.length > limit;
        const sliced = truncated ? hits.slice(0, limit) : hits;
        return {
          content: [{
            type: "text",
            text: JSON.stringify({
              term: params.term,
              total: hits.length,
              returned: sliced.length,
              truncated,
              hits: sliced,
            }, null, 2),
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );
}
