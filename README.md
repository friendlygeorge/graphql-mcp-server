# GraphQL MCP Server

[![npm](https://img.shields.io/npm/v/%40supernova123/graphql-mcp-server)](https://www.npmjs.com/package/@supernova123/graphql-mcp-server)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Glama](https://glama.ai/mcp/servers/friendlygeorge/graphql-mcp-server/badges/card.svg)](https://glama.ai/mcp/servers/friendlygeorge/graphql-mcp-server)

MCP server for GraphQL — schema introspection, auto-generated tools, query/mutation execution for Claude, Cursor, and AI agents.

## What It Does

Connects to **any GraphQL endpoint** and gives AI agents the ability to:

- **Introspect schemas** — discover all types, queries, mutations, and subscriptions
- **Execute queries and mutations** — raw GraphQL strings or typed field-based calls
- **Search and explore** — find types, fields, and arguments across the schema
- **Manage connections** — switch endpoints, configure auth, cache schemas

## Quick Start

```bash
npx @supernova123/graphql-mcp-server
```

Set your endpoint via environment variable:

```bash
GRAPHQL_ENDPOINT=https://your-api.com/graphql npx @supernova123/graphql-mcp-server
```

Or configure at runtime with the `connect_endpoint` tool.

## Tools (20)

### Connection & Configuration
| Tool | Description |
|------|-------------|
| `connect_endpoint` | Set or change the active GraphQL endpoint |
| `set_auth_token` | Configure Bearer token authentication |
| `set_basic_auth` | Configure HTTP Basic authentication |
| `set_headers` | Replace custom HTTP headers |
| `add_header` | Add/update a single header |
| `remove_header` | Remove a header |
| `get_connection_status` | Show endpoint config, auth state, and schema cache |

### Schema Introspection
| Tool | Description |
|------|-------------|
| `introspect_schema` | Fetch the full schema via introspection |
| `list_types` | List all types (filter by kind or name) |
| `describe_type` | Get full details of a single type |
| `list_queries` | List all root query fields |
| `list_mutations` | List all root mutation fields |
| `list_subscriptions` | List all root subscription fields |
| `describe_field` | Get full details of a field |
| `search_schema` | Search types and fields by substring |

### Execution
| Tool | Description |
|------|-------------|
| `execute_query` | Send a raw GraphQL query |
| `execute_mutation` | Send a raw GraphQL mutation |
| `execute_typed_query` | Execute a query by field name (auto-constructed) |
| `execute_typed_mutation` | Execute a mutation by field name (auto-constructed) |

### Cache Management
| Tool | Description |
|------|-------------|
| `get_cached_schema` | Return the cached introspection result |
| `clear_cache` | Clear schema cache |
| `reload_schema` | Force a fresh introspection |

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `GRAPHQL_ENDPOINT` | GraphQL endpoint URL | (none — must configure at runtime) |
| `GRAPHQL_AUTH_TOKEN` | Bearer token for Authorization header | (none) |
| `GRAPHQL_BASIC_USER` | Basic auth username | (none) |
| `GRAPHQL_BASIC_PASS` | Basic auth password | (none) |
| `GRAPHQL_TIMEOUT_MS` | Request timeout in milliseconds | 30000 |
| `GRAPHQL_HEADER_*` | Custom headers (e.g. `GRAPHQL_HEADER_X_API_KEY=secret`) | (none) |

## Configuration (Claude Desktop)

```json
{
  "mcpServers": {
    "graphql": {
      "command": "npx",
      "args": ["-y", "@supernova123/graphql-mcp-server"],
      "env": {
        "GRAPHQL_ENDPOINT": "https://your-api.com/graphql",
        "GRAPHQL_AUTH_TOKEN=***"
      }
    }
  }
}
```

## Features

- **No external GraphQL library** — minimal dependency surface, works at the HTTP layer
- **Schema caching** — introspect once, reuse across tool calls
- **Retry with backoff** — transient errors (5xx, 429, timeouts) are retried automatically
- **Output sanitization** — ANSI stripping and length capping prevent prompt injection
- **Type-safe** — TypeScript with Zod validation on all tool inputs
- **Auth flexibility** — Bearer tokens, Basic auth, or arbitrary HTTP headers

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
