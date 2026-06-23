/**
 * GraphQL introspection response types and schema helpers.
 *
 * The standard GraphQL introspection query returns a JSON document with
 * `__schema.types[]`, where each type has `kind`, `name`, `description`,
 * `fields`, `inputFields`, `interfaces`, `enumValues`, `possibleTypes`.
 *
 * We define the types we actually consume and helpers for:
 *   - Resolving a type reference (handling NON_NULL / LIST wrappers)
 *   - Listing queries, mutations, subscriptions
 *   - Searching types and fields by name
 *   - Caching the introspection result per endpoint
 */

// ---------- Type-reference resolution ----------

export type TypeRef =
  | { kind: "NON_NULL"; ofType: TypeRef }
  | { kind: "LIST"; ofType: TypeRef }
  | { kind: "SCALAR" | "OBJECT" | "INTERFACE" | "UNION" | "ENUM" | "INPUT_OBJECT"; name?: string; ofType?: null };

/** A bare type reference (e.g. "String!", "[User!]!"). */
export interface IntrospectionTypeRef {
  kind: string;
  name: string | null;
  ofType: IntrospectionTypeRef | null;
}

/** Unwrap NON_NULL and LIST wrappers to get the named underlying type. */
export function unwrapType(t: IntrospectionTypeRef | null | undefined): { name: string | null; kind: string | null } {
  if (!t) return { name: null, kind: null };
  if (t.ofType) return unwrapType(t.ofType);
  return { name: t.name, kind: t.kind };
}

/** Render a GraphQL type reference as a human-readable string, e.g. "[User!]!". */
export function printTypeRef(t: IntrospectionTypeRef | null | undefined): string {
  if (!t) return "Unknown";
  if (t.kind === "NON_NULL" && t.ofType) {
    return `${printTypeRef(t.ofType)}!`;
  }
  if (t.kind === "LIST" && t.ofType) {
    return `[${printTypeRef(t.ofType)}]`;
  }
  return t.name ?? "Unknown";
}

/** Check whether a type ref is non-null (e.g. required). */
export function isNonNull(t: IntrospectionTypeRef | null | undefined): boolean {
  return t?.kind === "NON_NULL";
}

/** Check whether a type ref is a list. */
export function isList(t: IntrospectionTypeRef | null | undefined): boolean {
  if (!t) return false;
  if (t.kind === "LIST") return true;
  if (t.kind === "NON_NULL" && t.ofType) return isList(t.ofType);
  return false;
}

// ---------- Introspection response types ----------

export interface IntrospectionArg {
  name: string;
  description: string | null;
  type: IntrospectionTypeRef;
  defaultValue: string | null;
}

export interface IntrospectionField {
  name: string;
  description: string | null;
  args: IntrospectionArg[];
  type: IntrospectionTypeRef;
  isDeprecated: boolean;
  deprecationReason: string | null;
}

export interface IntrospectionInputField {
  name: string;
  description: string | null;
  type: IntrospectionTypeRef;
  defaultValue: string | null;
}

export interface IntrospectionEnumValue {
  name: string;
  description: string | null;
  isDeprecated: boolean;
  deprecationReason: string | null;
}

export interface IntrospectionType {
  kind: string;
  name: string;
  description: string | null;
  fields: IntrospectionField[] | null;
  inputFields: IntrospectionInputField[] | null;
  interfaces: IntrospectionTypeRef[] | null;
  enumValues: IntrospectionEnumValue[] | null;
  possibleTypes: IntrospectionTypeRef[] | null;
}

export interface IntrospectionDirective {
  name: string;
  description: string | null;
  locations: string[];
  args: IntrospectionArg[];
}

export interface IntrospectionSchema {
  queryType: { name: string } | null;
  mutationType: { name: string } | null;
  subscriptionType: { name: string } | null;
  types: IntrospectionType[];
  directives: IntrospectionDirective[];
}

export interface IntrospectionResponse {
  __schema: IntrospectionSchema;
}

// ---------- Schema helpers ----------

const SYSTEM_TYPE_PREFIXES = ["__"];

export function isSystemType(name: string): boolean {
  return SYSTEM_TYPE_PREFIXES.some((p) => name.startsWith(p));
}

/** Get a type by name. */
export function getType(schema: IntrospectionSchema, name: string): IntrospectionType | null {
  return schema.types.find((t) => t.name === name) ?? null;
}

/** List all user-defined types (excludes __Schema, __Type, etc.). */
export function listUserTypes(schema: IntrospectionSchema): IntrospectionType[] {
  return schema.types.filter((t) => !isSystemType(t.name));
}

/** Get the root Query type. */
export function getQueryType(schema: IntrospectionSchema): IntrospectionType | null {
  if (!schema.queryType) return null;
  return getType(schema, schema.queryType.name);
}

/** Get the root Mutation type (null if schema has no mutations). */
export function getMutationType(schema: IntrospectionSchema): IntrospectionType | null {
  if (!schema.mutationType) return null;
  return getType(schema, schema.mutationType.name);
}

/** Get the root Subscription type (null if schema has no subscriptions). */
export function getSubscriptionType(schema: IntrospectionSchema): IntrospectionType | null {
  if (!schema.subscriptionType) return null;
  return getType(schema, schema.subscriptionType.name);
}

/** Get all fields of the root Query type. */
export function listQueries(schema: IntrospectionSchema): IntrospectionField[] {
  const q = getQueryType(schema);
  return q?.fields ?? [];
}

/** Get all fields of the root Mutation type. */
export function listMutations(schema: IntrospectionSchema): IntrospectionField[] {
  const m = getMutationType(schema);
  return m?.fields ?? [];
}

/** Get all fields of the root Subscription type. */
export function listSubscriptions(schema: IntrospectionSchema): IntrospectionField[] {
  const s = getSubscriptionType(schema);
  return s?.fields ?? [];
}

/** Get a specific field on a type by name. */
export function getField(type: IntrospectionType, name: string): IntrospectionField | null {
  return type.fields?.find((f) => f.name === name) ?? null;
}

/**
 * Find a root operation (query/mutation/subscription) by name.
 * Searches queries first, then mutations, then subscriptions.
 */
export function findOperation(schema: IntrospectionSchema, name: string): { kind: "query" | "mutation" | "subscription"; field: IntrospectionField } | null {
  for (const f of listQueries(schema)) {
    if (f.name === name) return { kind: "query", field: f };
  }
  for (const f of listMutations(schema)) {
    if (f.name === name) return { kind: "mutation", field: f };
  }
  for (const f of listSubscriptions(schema)) {
    if (f.name === name) return { kind: "subscription", field: f };
  }
  return null;
}

/** Search types and fields by name (case-insensitive substring). */
export interface SearchHit {
  kind: "type" | "field" | "inputField" | "enumValue";
  parentType: string;
  name: string;
  type: string;
  description: string | null;
}

export function searchSchema(schema: IntrospectionSchema, term: string): SearchHit[] {
  const needle = term.toLowerCase();
  const hits: SearchHit[] = [];

  for (const t of listUserTypes(schema)) {
    if (t.name.toLowerCase().includes(needle)) {
      hits.push({ kind: "type", parentType: t.name, name: t.name, type: t.kind, description: t.description });
    }
    if (t.fields) {
      for (const f of t.fields) {
        if (f.name.toLowerCase().includes(needle)) {
          hits.push({ kind: "field", parentType: t.name, name: f.name, type: printTypeRef(f.type), description: f.description });
        }
      }
    }
    if (t.inputFields) {
      for (const f of t.inputFields) {
        if (f.name.toLowerCase().includes(needle)) {
          hits.push({ kind: "inputField", parentType: t.name, name: f.name, type: printTypeRef(f.type), description: f.description });
        }
      }
    }
    if (t.enumValues) {
      for (const v of t.enumValues) {
        if (v.name.toLowerCase().includes(needle)) {
          hits.push({ kind: "enumValue", parentType: t.name, name: v.name, type: "enum", description: v.description });
        }
      }
    }
  }
  return hits;
}

// ---------- Schema cache ----------

/**
 * In-memory cache of introspection results, keyed by endpoint URL.
 * The schema is fetched once per endpoint and reused until explicitly cleared.
 */
export class SchemaCache {
  private cache = new Map<string, { schema: IntrospectionSchema; fetchedAt: string }>();

  has(endpoint: string): boolean {
    return this.cache.has(endpoint);
  }

  get(endpoint: string): IntrospectionSchema | null {
    return this.cache.get(endpoint)?.schema ?? null;
  }

  getFetchedAt(endpoint: string): string | null {
    return this.cache.get(endpoint)?.fetchedAt ?? null;
  }

  set(endpoint: string, schema: IntrospectionSchema): void {
    this.cache.set(endpoint, { schema, fetchedAt: new Date().toISOString() });
  }

  clear(endpoint?: string): void {
    if (endpoint) {
      this.cache.delete(endpoint);
    } else {
      this.cache.clear();
    }
  }

  list(): Array<{ endpoint: string; fetchedAt: string; typeCount: number }> {
    return Array.from(this.cache.entries()).map(([endpoint, entry]) => ({
      endpoint,
      fetchedAt: entry.fetchedAt,
      typeCount: entry.schema.types.length,
    }));
  }
}

// ---------- Introspection query string ----------

/**
 * The standard GraphQL introspection query. Returns enough detail to:
 *   - List all queries, mutations, subscriptions
 *   - Describe each field's args and return type
 *   - Describe each input type's fields
 *   - Describe each enum's values
 *   - Resolve type refs through NON_NULL and LIST wrappers
 */
export const INTROSPECTION_QUERY = `
  query IntrospectionQuery {
    __schema {
      queryType { name }
      mutationType { name }
      subscriptionType { name }
      types {
        kind
        name
        description
        fields(includeDeprecated: true) {
          name
          description
          args {
            name
            description
            type {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                  ofType {
                    kind
                    name
                  }
                }
              }
            }
            defaultValue
          }
          type {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
                ofType {
                  kind
                  name
                }
              }
            }
          }
          isDeprecated
          deprecationReason
        }
        inputFields {
          name
          description
          type {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
          defaultValue
        }
        interfaces {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
        enumValues(includeDeprecated: true) {
          name
          description
          isDeprecated
          deprecationReason
        }
        possibleTypes {
          kind
          name
          ofType {
            kind
            name
            ofType {
              kind
              name
            }
          }
        }
      }
      directives {
        name
        description
        locations
        args {
          name
          description
          type {
            kind
            name
            ofType {
              kind
              name
              ofType {
                kind
                name
              }
            }
          }
          defaultValue
        }
      }
    }
  }
`;
