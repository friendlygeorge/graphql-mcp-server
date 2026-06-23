/**
 * Query and mutation execution tools.
 *
 * Three tools, each at a different level of abstraction:
 *
 *   1. execute_query       — pass a raw GraphQL string. Maximum flexibility.
 *   2. execute_mutation    — same as execute_query but called out as a mutation
 *                            for semantic clarity (no functional difference).
 *   3. execute_typed_query — pass a field name + variables; the server
 *                            auto-constructs a query using the cached schema.
 *   4. execute_typed_mutation — same as execute_typed_query, for mutations.
 *
 * Use execute_query / execute_mutation when the agent has the full query
 * string already (e.g. pasted from API docs). Use execute_typed_* when the
 * agent has introspected the schema and just needs to call a field by name.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatError, GraphQLClient, withRetry } from "../client.js";
import type { ServerContext } from "../context.js";
import {
  ExecuteMutationSchema,
  ExecuteQuerySchema,
  ExecuteTypedMutationSchema,
  ExecuteTypedQuerySchema,
} from "../types.js";
import {
  findOperation,
  getMutationType,
  getQueryType,
  getType,
  printTypeRef,
  unwrapType,
  type IntrospectionField,
  type IntrospectionType,
} from "../schema.js";

/** Format a variables object for inclusion in a query as inline $defs. */
function variablesToGraphQL(vars: Record<string, unknown> | undefined): string {
  if (!vars || Object.keys(vars).length === 0) return "";
  const entries = Object.entries(vars)
    .map(([k, v]) => {
      // Render the JSON value back as a GraphQL literal. We deliberately use
      // JSON for objects/arrays since we don't know the target type's structure
      // (the server accepts JSON input and converts as best it can).
      if (v === null || v === undefined) return `$${k}: _Unused`;
      if (typeof v === "number" || typeof v === "boolean") return `$${k}: _Unused`;
      if (typeof v === "string") return `$${k}: _Unused`;
      return `$${k}: _Unused`;
    });
  return `(${entries.join(", ")})`;
}

/**
 * Build a default selection set for a return type.
 * Returns __typename plus a flat set of leaf fields (no nested objects).
 * For lists/objects without leaf fields, includes __typename only.
 */
function buildDefaultSelection(returnType: IntrospectionType | null, includeDeprecated: boolean): string {
  if (!returnType) return "__typename";
  const named = unwrapType({ kind: returnType.kind, name: returnType.name, ofType: null });
  if (!named.name) return "__typename";

  const target = named.kind === "OBJECT" || named.kind === "INTERFACE" ? returnType : null;
  if (!target || !target.fields) {
    // SCALAR, ENUM, UNION — return __typename
    return "__typename";
  }
  const scalarNames = new Set(["String", "Int", "Float", "Boolean", "ID"]);
  const leaves: string[] = [];
  for (const f of target.fields) {
    if (!includeDeprecated && f.isDeprecated) continue;
    const u = unwrapType(f.type);
    if (u.name && scalarNames.has(u.name)) {
      leaves.push(f.name);
    } else if (u.kind === "ENUM") {
      leaves.push(f.name);
    }
  }
  if (leaves.length === 0) return "__typename";
  if (leaves.length > 10) {
    return `__typename ${leaves.slice(0, 10).join(" ")}`;
  }
  return `__typename ${leaves.join(" ")}`;
}

/** Find an input type by name and return its name as a string. */
function getFieldArgInputTypes(field: IntrospectionField): Array<{ name: string; type: string; description: string | null }> {
  return field.args.map((a) => ({
    name: a.name,
    type: printTypeRef(a.type),
    description: a.description,
  }));
}

export function registerExecuteTools(server: McpServer, ctx: ServerContext): void {
  // -----------------------------------------------------------------------
  // execute_query
  // -----------------------------------------------------------------------
  server.tool(
    "execute_query",
    "Send a raw GraphQL query string to the endpoint. Use this when you already have a complete query — for example, one written by a human or copied from API docs. Returns the data field of the response, or a structured error message if the server returned errors. Variables are passed through as-is. Idempotent: same query → same result (for read-only queries).",
    ExecuteQuerySchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async (params) => {
      try {
        const client = ctx.getClient();
        const resp = await withRetry(
          () => client.execute({ query: params.query, variables: params.variables, operationName: params.operation_name }),
          { label: "execute_query" }
        );
        return { content: [{ type: "text", text: GraphQLClient.formatResponse(resp) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // execute_mutation
  // -----------------------------------------------------------------------
  server.tool(
    "execute_mutation",
    "Send a raw GraphQL mutation string to the endpoint. Functionally identical to execute_query — use whichever is more semantically clear. Not idempotent: mutations can have side effects.",
    ExecuteMutationSchema.shape,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async (params) => {
      try {
        const client = ctx.getClient();
        const resp = await withRetry(
          () => client.execute({ query: params.mutation, variables: params.variables, operationName: params.operation_name }),
          { label: "execute_mutation" }
        );
        return { content: [{ type: "text", text: GraphQLClient.formatResponse(resp) }] };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // execute_typed_query
  // -----------------------------------------------------------------------
  server.tool(
    "execute_typed_query",
    "Execute a query by field name. Looks up the field on the root Query type using the introspected schema, validates that the variables you pass match the field's argument types (by name), and constructs a query string automatically. If you don't provide a selection set, the server auto-builds one with __typename plus scalar fields. Requires the schema to be introspected first.",
    ExecuteTypedQuerySchema.shape,
    { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    async (params) => {
      try {
        const schema = await ctx.getSchema();
        const queryType = getQueryType(schema);
        if (!queryType) {
          return { content: [{ type: "text", text: "Error: Schema has no Query type." }], isError: true };
        }
        const field = (queryType.fields ?? []).find((f) => f.name === params.field);
        if (!field) {
          return {
            content: [{ type: "text", text: `Error: Query field '${params.field}' not found. Use list_queries to see available fields.` }],
            isError: true,
          };
        }

        // Validate provided variables against expected arg names
        const expectedArgs = new Set(field.args.map((a) => a.name));
        const providedVars = params.variables ?? {};
        const providedKeys = new Set(Object.keys(providedVars));
        const missing = field.args.filter((a) => isArgRequired(a) && !providedKeys.has(a.name));
        if (missing.length) {
          return {
            content: [{ type: "text", text: `Error: Missing required arguments: ${missing.map((a) => a.name).join(", ")}. Expected: ${getFieldArgInputTypes(field).map((a) => `${a.name}: ${a.type}`).join(", ")}` }],
            isError: true,
          };
        }
        const unknown = Array.from(providedKeys).filter((k) => !expectedArgs.has(k));
        if (unknown.length) {
          return {
            content: [{ type: "text", text: `Error: Unknown arguments for '${params.field}': ${unknown.join(", ")}. Expected: ${getFieldArgInputTypes(field).map((a) => a.name).join(", ")}` }],
            isError: true,
          };
        }

        // Build inline args from variables
        const argParts: string[] = [];
        for (const a of field.args) {
          if (providedVars[a.name] !== undefined) {
            argParts.push(`${a.name}: $${a.name}`);
          }
        }
        const argsClause = argParts.length ? `(${argParts.join(", ")})` : "";

        // Build variable declarations
        const varDecls: string[] = [];
        for (const a of field.args) {
          if (providedVars[a.name] !== undefined) {
            // Use a permissive type that accepts JSON. We let the server validate.
            varDecls.push(`$${a.name}: ${printTypeRef(a.type)}`);
          }
        }
        const varDecl = varDecls.length ? `(${varDecls.join(", ")})` : "";

        // Build selection set
        const returnTypeName = unwrapType(field.type).name;
        const returnType = returnTypeName ? getType(schema, returnTypeName) : null;
        const selection = params.selection ?? buildDefaultSelection(returnType, params.include_deprecated ?? false);

        // Build the query
        const query = `query ${varDecl} { ${params.field}${argsClause} { ${selection} } }`;

        const client = ctx.getClient();
        const resp = await withRetry(
          () => client.execute({ query, variables: providedVars }),
          { label: "execute_typed_query" }
        );
        const output = GraphQLClient.formatResponse(resp);
        return {
          content: [{
            type: "text",
            text: `${output}\n\n---\n_Generated query:_\n\`\`\`graphql\n${query}\n\`\`\``,
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );

  // -----------------------------------------------------------------------
  // execute_typed_mutation
  // -----------------------------------------------------------------------
  server.tool(
    "execute_typed_mutation",
    "Execute a mutation by field name. Looks up the field on the root Mutation type, validates arguments, and constructs the mutation. If selection is omitted, defaults to __typename. Not idempotent — mutations can have side effects.",
    ExecuteTypedMutationSchema.shape,
    { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    async (params) => {
      try {
        const schema = await ctx.getSchema();
        const mutationType = getMutationType(schema);
        if (!mutationType) {
          return { content: [{ type: "text", text: "Error: Schema has no Mutation type." }], isError: true };
        }
        const field = (mutationType.fields ?? []).find((f) => f.name === params.field);
        if (!field) {
          return {
            content: [{ type: "text", text: `Error: Mutation field '${params.field}' not found. Use list_mutations to see available fields.` }],
            isError: true,
          };
        }

        // Validate variables
        const expectedArgs = new Set(field.args.map((a) => a.name));
        const providedVars = params.variables ?? {};
        const providedKeys = new Set(Object.keys(providedVars));
        const missing = field.args.filter((a) => isArgRequired(a) && !providedKeys.has(a.name));
        if (missing.length) {
          return {
            content: [{ type: "text", text: `Error: Missing required arguments: ${missing.map((a) => a.name).join(", ")}. Expected: ${getFieldArgInputTypes(field).map((a) => `${a.name}: ${a.type}`).join(", ")}` }],
            isError: true,
          };
        }
        const unknown = Array.from(providedKeys).filter((k) => !expectedArgs.has(k));
        if (unknown.length) {
          return {
            content: [{ type: "text", text: `Error: Unknown arguments for '${params.field}': ${unknown.join(", ")}. Expected: ${getFieldArgInputTypes(field).map((a) => a.name).join(", ")}` }],
            isError: true,
          };
        }

        const argParts: string[] = [];
        for (const a of field.args) {
          if (providedVars[a.name] !== undefined) {
            argParts.push(`${a.name}: $${a.name}`);
          }
        }
        const argsClause = argParts.length ? `(${argParts.join(", ")})` : "";

        const varDecls: string[] = [];
        for (const a of field.args) {
          if (providedVars[a.name] !== undefined) {
            varDecls.push(`$${a.name}: ${printTypeRef(a.type)}`);
          }
        }
        const varDecl = varDecls.length ? `(${varDecls.join(", ")})` : "";

        const returnTypeName = unwrapType(field.type).name;
        const returnType = returnTypeName ? getType(schema, returnTypeName) : null;
        const selection = params.selection ?? buildDefaultSelection(returnType, false);

        const mutation = `mutation ${varDecl} { ${params.field}${argsClause} { ${selection} } }`;

        const client = ctx.getClient();
        const resp = await withRetry(
          () => client.execute({ query: mutation, variables: providedVars }),
          { label: "execute_typed_mutation" }
        );
        const output = GraphQLClient.formatResponse(resp);
        return {
          content: [{
            type: "text",
            text: `${output}\n\n---\n_Generated mutation:_\n\`\`\`graphql\n${mutation}\n\`\`\``,
          }],
        };
      } catch (error) {
        return { content: [{ type: "text", text: `Error: ${formatError(error)}` }], isError: true };
      }
    }
  );
}

/** Check whether an argument is required (NON_NULL with no defaultValue). */
function isArgRequired(arg: { type: { kind: string; ofType: unknown }; defaultValue: string | null }): boolean {
  if (arg.defaultValue !== null) return false;
  return arg.type.kind === "NON_NULL";
}
