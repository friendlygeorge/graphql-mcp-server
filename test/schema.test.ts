import { describe, it, expect } from "vitest";
import {
  unwrapType,
  printTypeRef,
  isNonNull,
  isList,
  isSystemType,
  listUserTypes,
  searchSchema,
  INTROSPECTION_QUERY,
  SchemaCache,
  type IntrospectionSchema,
  type IntrospectionTypeRef,
} from "../src/schema.js";
import {
  GraphQLClient,
  GraphQLHttpError,
  formatError,
  sanitizeOutput,
} from "../src/client.js";
import { ServerContext, configFromEnv } from "../src/context.js";

// ---------- Schema helpers ----------

describe("unwrapType", () => {
  it("unwraps a named scalar", () => {
    const ref: IntrospectionTypeRef = { kind: "SCALAR", name: "String", ofType: null };
    expect(unwrapType(ref)).toEqual({ name: "String", kind: "SCALAR" });
  });

  it("unwraps NON_NULL wrapper", () => {
    const ref: IntrospectionTypeRef = {
      kind: "NON_NULL",
      name: null,
      ofType: { kind: "SCALAR", name: "String", ofType: null },
    };
    expect(unwrapType(ref)).toEqual({ name: "String", kind: "SCALAR" });
  });

  it("unwraps LIST of NON_NULL", () => {
    const ref: IntrospectionTypeRef = {
      kind: "LIST",
      name: null,
      ofType: {
        kind: "NON_NULL",
        name: null,
        ofType: { kind: "SCALAR", name: "Int", ofType: null },
      },
    };
    expect(unwrapType(ref)).toEqual({ name: "Int", kind: "SCALAR" });
  });

  it("handles null", () => {
    expect(unwrapType(null)).toEqual({ name: null, kind: null });
  });
});

describe("printTypeRef", () => {
  it("prints a simple scalar", () => {
    const ref: IntrospectionTypeRef = { kind: "SCALAR", name: "String", ofType: null };
    expect(printTypeRef(ref)).toBe("String");
  });

  it("prints NON_NULL", () => {
    const ref: IntrospectionTypeRef = {
      kind: "NON_NULL",
      name: null,
      ofType: { kind: "SCALAR", name: "String", ofType: null },
    };
    expect(printTypeRef(ref)).toBe("String!");
  });

  it("prints LIST", () => {
    const ref: IntrospectionTypeRef = {
      kind: "LIST",
      name: null,
      ofType: { kind: "SCALAR", name: "Int", ofType: null },
    };
    expect(printTypeRef(ref)).toBe("[Int]");
  });

  it("prints nested LIST of NON_NULL", () => {
    const ref: IntrospectionTypeRef = {
      kind: "NON_NULL",
      name: null,
      ofType: {
        kind: "LIST",
        name: null,
        ofType: {
          kind: "NON_NULL",
          name: null,
          ofType: { kind: "SCALAR", name: "String", ofType: null },
        },
      },
    };
    expect(printTypeRef(ref)).toBe("[String!]!");
  });

  it("handles null", () => {
    expect(printTypeRef(null)).toBe("Unknown");
  });
});

describe("isNonNull", () => {
  it("returns true for NON_NULL", () => {
    expect(isNonNull({ kind: "NON_NULL", name: null, ofType: null })).toBe(true);
  });

  it("returns false for SCALAR", () => {
    expect(isNonNull({ kind: "SCALAR", name: "String", ofType: null })).toBe(false);
  });

  it("returns false for null", () => {
    expect(isNonNull(null)).toBe(false);
  });
});

describe("isList", () => {
  it("returns true for LIST", () => {
    expect(isList({ kind: "LIST", name: null, ofType: null })).toBe(true);
  });

  it("returns true for NON_NULL wrapping LIST", () => {
    expect(
      isList({
        kind: "NON_NULL",
        name: null,
        ofType: { kind: "LIST", name: null, ofType: null },
      })
    ).toBe(true);
  });

  it("returns false for SCALAR", () => {
    expect(isList({ kind: "SCALAR", name: "String", ofType: null })).toBe(false);
  });
});

describe("isSystemType", () => {
  it("identifies __Schema as system type", () => {
    expect(isSystemType("__Schema")).toBe(true);
  });

  it("identifies __Type as system type", () => {
    expect(isSystemType("__Type")).toBe(true);
  });

  it("allows User type", () => {
    expect(isSystemType("User")).toBe(false);
  });
});

describe("listUserTypes", () => {
  it("filters out system types", () => {
    const schema: IntrospectionSchema = {
      queryType: { name: "Query" },
      mutationType: null,
      subscriptionType: null,
      types: [
        { kind: "SCALAR", name: "__Schema", description: null, fields: null, inputFields: null, interfaces: null, enumValues: null, possibleTypes: null },
        { kind: "OBJECT", name: "User", description: null, fields: [], inputFields: null, interfaces: null, enumValues: null, possibleTypes: null },
        { kind: "SCALAR", name: "__Type", description: null, fields: null, inputFields: null, interfaces: null, enumValues: null, possibleTypes: null },
        { kind: "OBJECT", name: "Query", description: null, fields: [], inputFields: null, interfaces: null, enumValues: null, possibleTypes: null },
      ],
      directives: [],
    };
    const userTypes = listUserTypes(schema);
    expect(userTypes.map((t) => t.name)).toEqual(["User", "Query"]);
  });
});

describe("searchSchema", () => {
  const schema: IntrospectionSchema = {
    queryType: { name: "Query" },
    mutationType: null,
    subscriptionType: null,
    types: [
      {
        kind: "OBJECT",
        name: "User",
        description: "A user",
        fields: [
          { name: "id", description: null, args: [], type: { kind: "NON_NULL", name: null, ofType: { kind: "SCALAR", name: "ID", ofType: null } }, isDeprecated: false, deprecationReason: null },
          { name: "email", description: "Contact email", args: [], type: { kind: "SCALAR", name: "String", ofType: null }, isDeprecated: false, deprecationReason: null },
        ],
        inputFields: null,
        interfaces: null,
        enumValues: null,
        possibleTypes: null,
      },
      {
        kind: "INPUT_OBJECT",
        name: "CreateUserInput",
        description: null,
        fields: null,
        inputFields: [
          { name: "email", description: null, type: { kind: "NON_NULL", name: null, ofType: { kind: "SCALAR", name: "String", ofType: null } }, defaultValue: null },
        ],
        interfaces: null,
        enumValues: null,
        possibleTypes: null,
      },
    ],
    directives: [],
  };

  it("finds types by name", () => {
    const hits = searchSchema(schema, "User");
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits.some((h) => h.name === "User" && h.kind === "type")).toBe(true);
  });

  it("finds fields by name", () => {
    const hits = searchSchema(schema, "email");
    expect(hits.length).toBeGreaterThanOrEqual(2); // User.email + CreateUserInput.email
  });

  it("is case-insensitive", () => {
    const hits = searchSchema(schema, "user");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------- SchemaCache ----------

describe("SchemaCache", () => {
  it("stores and retrieves schemas", () => {
    const cache = new SchemaCache();
    const schema: IntrospectionSchema = {
      queryType: { name: "Query" },
      mutationType: null,
      subscriptionType: null,
      types: [],
      directives: [],
    };

    expect(cache.has("http://example.com")).toBe(false);
    cache.set("http://example.com", schema);
    expect(cache.has("http://example.com")).toBe(true);
    expect(cache.get("http://example.com")).toBe(schema);
  });

  it("clears by endpoint", () => {
    const cache = new SchemaCache();
    const schema: IntrospectionSchema = {
      queryType: { name: "Query" },
      mutationType: null,
      subscriptionType: null,
      types: [],
      directives: [],
    };
    cache.set("http://a.com", schema);
    cache.set("http://b.com", schema);
    cache.clear("http://a.com");
    expect(cache.has("http://a.com")).toBe(false);
    expect(cache.has("http://b.com")).toBe(true);
  });

  it("clears all", () => {
    const cache = new SchemaCache();
    const schema: IntrospectionSchema = {
      queryType: { name: "Query" },
      mutationType: null,
      subscriptionType: null,
      types: [],
      directives: [],
    };
    cache.set("http://a.com", schema);
    cache.set("http://b.com", schema);
    cache.clear();
    expect(cache.list()).toHaveLength(0);
  });

  it("lists entries", () => {
    const cache = new SchemaCache();
    const schema: IntrospectionSchema = {
      queryType: { name: "Query" },
      mutationType: null,
      subscriptionType: null,
      types: [{ kind: "OBJECT", name: "Query", description: null, fields: [], inputFields: null, interfaces: null, enumValues: null, possibleTypes: null }],
      directives: [],
    };
    cache.set("http://example.com", schema);
    const list = cache.list();
    expect(list).toHaveLength(1);
    expect(list[0].endpoint).toBe("http://example.com");
    expect(list[0].typeCount).toBe(1);
  });
});

// ---------- Client ----------

describe("GraphQLClient", () => {
  it("formats a successful response", () => {
    const resp = { data: { user: { id: "1" } } };
    expect(GraphQLClient.formatResponse(resp)).toBe(JSON.stringify({ user: { id: "1" } }, null, 2));
  });

  it("formats a response with errors", () => {
    const resp = {
      data: null,
      errors: [{ message: "Not found", path: ["user"], locations: [{ line: 1, column: 1 }] }],
    };
    const formatted = GraphQLClient.formatResponse(resp);
    expect(formatted).toContain("1 error(s)");
    expect(formatted).toContain("Not found");
    expect(formatted).toContain("user");
  });

  it("formats a response with no data", () => {
    const resp = { errors: [{ message: "Error" }] };
    const formatted = GraphQLClient.formatResponse(resp);
    expect(formatted).toContain("Error");
  });
});

describe("formatError", () => {
  it("formats GraphQLHttpError", () => {
    const err = new GraphQLHttpError(404, "Not Found", "Resource not found");
    expect(formatError(err)).toContain("404");
    expect(formatError(err)).toContain("Resource not found");
  });

  it("formats Error", () => {
    expect(formatError(new Error("something broke"))).toBe("something broke");
  });

  it("formats string", () => {
    expect(formatError("plain string")).toBe("plain string");
  });

  it("formats AbortError as timeout", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(formatError(err)).toContain("timeout");
  });
});

describe("sanitizeOutput", () => {
  it("strips ANSI escapes", () => {
    const input = "\x1b[31mred text\x1b[0m";
    expect(sanitizeOutput(input)).toBe("red text");
  });

  it("truncates long output", () => {
    const input = "x".repeat(2_000_000);
    const result = sanitizeOutput(input, 100);
    expect(result.length).toBeLessThan(200);
    expect(result).toContain("truncated");
  });

  it("passes short output through", () => {
    expect(sanitizeOutput("hello")).toBe("hello");
  });
});

// ---------- ServerContext ----------

describe("ServerContext", () => {
  it("starts unconfigured", () => {
    const ctx = new ServerContext();
    expect(ctx.isConfigured()).toBe(false);
    expect(ctx.getEndpoint()).toBeNull();
  });

  it("configures with endpoint", () => {
    const ctx = new ServerContext();
    ctx.configure({ endpoint: "http://example.com/graphql" });
    expect(ctx.isConfigured()).toBe(true);
    expect(ctx.getEndpoint()).toBe("http://example.com/graphql");
  });

  it("throws when getting client before config", () => {
    const ctx = new ServerContext();
    expect(() => ctx.getClient()).toThrow("No GraphQL endpoint configured");
  });

  it("clears cache", () => {
    const ctx = new ServerContext();
    ctx.configure({ endpoint: "http://example.com/graphql" });
    const removed = ctx.clearCache();
    expect(removed).toBe(0);
  });
});

describe("configFromEnv", () => {
  it("reads GRAPHQL_ENDPOINT", () => {
    const original = process.env.GRAPHQL_ENDPOINT;
    try {
      process.env.GRAPHQL_ENDPOINT = "http://test.example.com/graphql";
      const config = configFromEnv();
      expect(config.endpoint).toBe("http://test.example.com/graphql");
    } finally {
      if (original !== undefined) {
        process.env.GRAPHQL_ENDPOINT = original;
      } else {
        delete process.env.GRAPHQL_ENDPOINT;
      }
    }
  });

  it("reads GRAPHQL_AUTH_TOKEN", () => {
    const original = process.env.GRAPHQL_AUTH_TOKEN;
    try {
      process.env.GRAPHQL_AUTH_TOKEN = "my-token";
      const config = configFromEnv();
      expect(config.authToken).toBe("my-token");
    } finally {
      if (original !== undefined) {
        process.env.GRAPHQL_AUTH_TOKEN = original;
      } else {
        delete process.env.GRAPHQL_AUTH_TOKEN;
      }
    }
  });

  it("reads GRAPHQL_HEADER_*", () => {
    const original = process.env.GRAPHQL_HEADER_X_API_KEY;
    try {
      process.env.GRAPHQL_HEADER_X_API_KEY = "secret";
      const config = configFromEnv();
      expect(config.headers).toEqual({ "X-API-KEY": "secret" });
    } finally {
      if (original !== undefined) {
        process.env.GRAPHQL_HEADER_X_API_KEY = original;
      } else {
        delete process.env.GRAPHQL_HEADER_X_API_KEY;
      }
    }
  });
});

// ---------- Introspection query ----------

describe("INTROSPECTION_QUERY", () => {
  it("is a non-empty string", () => {
    expect(INTROSPECTION_QUERY.length).toBeGreaterThan(100);
  });

  it("contains __schema", () => {
    expect(INTROSPECTION_QUERY).toContain("__schema");
  });
});
