/**
 * Zod schemas for tool inputs.
 *
 * These define the shape of arguments each MCP tool accepts. They are
 * intentionally permissive (variables are typed as Record<string, unknown>)
 * because the GraphQL schema is dynamic — type information comes from
 * introspection, not from these schemas.
 */

import { z } from "zod";

// ---------- Connection / configuration ----------

export const ConnectEndpointSchema = z.object({
  endpoint: z
    .string()
    .url()
    .describe("GraphQL endpoint URL (e.g. https://api.example.com/graphql). Must support introspection."),
  timeout_ms: z.number().int().positive().max(120_000).optional()
    .describe("Request timeout in milliseconds (default: 30000, max: 120000)"),
});

export const SetAuthTokenSchema = z.object({
  token: z
    .string()
    .describe("Bearer token to send in the Authorization header. Pass empty string to clear."),
});

export const SetBasicAuthSchema = z.object({
  username: z.string().describe("Username for HTTP Basic authentication"),
  password: z.string().describe("Password for HTTP Basic authentication"),
});

export const SetHeadersSchema = z.object({
  headers: z
    .record(z.string(), z.string())
    .describe("Headers to send with every request. Replaces the existing set. Common: { 'X-API-Key': '...', 'X-Tenant': '...' }"),
});

export const AddHeaderSchema = z.object({
  key: z.string().describe("Header name (e.g. 'X-API-Key')"),
  value: z.string().describe("Header value"),
});

export const RemoveHeaderSchema = z.object({
  key: z.string().describe("Header name to remove"),
});

export const GetConnectionStatusSchema = z.object({
  ping: z.boolean().optional()
    .describe("If true, send a lightweight {__typename} query to verify the endpoint is reachable. Default: false (just show config)."),
});

// ---------- Schema introspection ----------

export const IntrospectSchemaSchema = z.object({
  force: z.boolean().optional()
    .describe("If true, re-fetch the schema even if cached. Default: false (use cache if available)."),
});

export const ListTypesSchema = z.object({
  kind: z
    .enum(["OBJECT", "SCALAR", "INTERFACE", "UNION", "ENUM", "INPUT_OBJECT", "ALL"])
    .optional()
    .describe("Filter by type kind. Default: ALL"),
  search: z.string().optional()
    .describe("Case-insensitive substring filter on type name"),
  limit: z.number().int().positive().max(2000).optional()
    .describe("Maximum number of types to return (default: 200, max: 2000)"),
});

export const DescribeTypeSchema = z.object({
  type_name: z.string().describe("Name of the GraphQL type to describe (e.g. 'User', 'CreateUserInput')"),
  include_deprecated: z.boolean().optional()
    .describe("Include deprecated fields and enum values. Default: true"),
});

export const ListQueriesSchema = z.object({
  search: z.string().optional().describe("Case-insensitive substring filter on query name"),
  limit: z.number().int().positive().max(2000).optional().describe("Max number of queries to return (default: 200)"),
});

export const ListMutationsSchema = z.object({
  search: z.string().optional().describe("Case-insensitive substring filter on mutation name"),
  limit: z.number().int().positive().max(2000).optional().describe("Max number of mutations to return (default: 200)"),
});

export const ListSubscriptionsSchema = z.object({
  search: z.string().optional().describe("Case-insensitive substring filter on subscription name"),
  limit: z.number().int().positive().max(2000).optional().describe("Max number of subscriptions to return (default: 200)"),
});

export const DescribeFieldSchema = z.object({
  type_name: z.string().describe("Name of the parent type (e.g. 'Query', 'Mutation', 'User')"),
  field_name: z.string().describe("Name of the field to describe"),
});

export const SearchSchemaSchema = z.object({
  term: z.string().min(1).describe("Substring to search for in type and field names (case-insensitive)"),
  limit: z.number().int().positive().max(500).optional().describe("Max number of hits to return (default: 100)"),
});

// ---------- Execution ----------

export const ExecuteQuerySchema = z.object({
  query: z
    .string()
    .min(1)
    .describe("GraphQL query string. Example: '{ user(id: 42) { id name email } }'"),
  variables: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Variables to pass alongside the query. Example: { 'id': 42 }. Use ${varName} in the query to reference them."),
  operation_name: z.string().optional()
    .describe("If the query contains multiple operations, the name of the one to execute."),
});

export const ExecuteMutationSchema = z.object({
  mutation: z
    .string()
    .min(1)
    .describe("GraphQL mutation string. Example: 'mutation { updateUser(id: 42, input: {...}) { id } }'"),
  variables: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Variables to pass alongside the mutation. Use $varName in the mutation to reference them."),
  operation_name: z.string().optional()
    .describe("If the mutation contains multiple operations, the name of the one to execute."),
});

export const ExecuteTypedQuerySchema = z.object({
  field: z.string().describe("Name of the query field to call (e.g. 'user'). The server will look this up on the root Query type."),
  variables: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Variables to pass to the field (must match the field's argument types)."),
  selection: z
    .string()
    .optional()
    .describe("GraphQL selection set as a string (e.g. 'id name email posts { title }'). If omitted, the server requests __typename and scalar fields automatically."),
  include_deprecated: z.boolean().optional()
    .describe("Allow deprecated fields in auto-generated selection sets. Default: false."),
});

export const ExecuteTypedMutationSchema = z.object({
  field: z.string().describe("Name of the mutation field to call (e.g. 'createUser')."),
  variables: z
    .record(z.string(), z.unknown())
    .optional()
    .describe("Variables to pass to the field (must match the field's argument types)."),
  selection: z
    .string()
    .optional()
    .describe("GraphQL selection set as a string. If omitted, the server requests __typename."),
});

// ---------- Cache management ----------

export const GetCachedSchemaSchema = z.object({
  include_system_types: z.boolean().optional()
    .describe("Include __Schema, __Type, etc. Default: false."),
  max_depth: z.number().int().positive().max(10).optional()
    .describe("Max depth of type traversal in the response (default: 3). Higher values produce very large output."),
});

export const ClearCacheSchema = z.object({
  endpoint: z.string().optional()
    .describe("Endpoint URL to clear. If omitted, clears the entire cache."),
});

export const ReloadSchemaSchema = z.object({
  endpoint: z.string().optional()
    .describe("Endpoint to reload. If omitted, reloads the current endpoint."),
});
