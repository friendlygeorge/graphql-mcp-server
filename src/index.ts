#!/usr/bin/env node
/**
 * Entry point for the GraphQL MCP server.
 *
 * Starts an MCP server over stdio. The agent connects via stdio, then
 * calls `connect_endpoint` (or relies on the GRAPHQL_ENDPOINT env var) to
 * point the server at a GraphQL backend.
 *
 * Environment variables:
 *   GRAPHQL_ENDPOINT       Endpoint URL (optional — can be set at runtime)
 *   GRAPHQL_AUTH_TOKEN     Bearer token (optional)
 *   GRAPHQL_BASIC_USER     Basic auth username (optional)
 *   GRAPHQL_BASIC_PASS     Basic auth password (optional)
 *   GRAPHQL_TIMEOUT_MS     Request timeout in ms (optional, default 30000)
 *   GRAPHQL_HEADER_*       Any extra header, e.g. GRAPHQL_HEADER_X_API_KEY=***
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

async function main() {
  const { server, ctx } = createServer();

  if (ctx.isConfigured()) {
    process.stderr.write(`GraphQL MCP server ready — endpoint: ${ctx.getEndpoint()}\n`);
  } else {
    process.stderr.write(`GraphQL MCP server ready — no endpoint configured. Use connect_endpoint or set GRAPHQL_ENDPOINT.\n`);
  }

  const transport = new StdioServerTransport();
  await server.connect(transport);

  // Graceful shutdown on signals (best-effort; stdio clients don't usually signal)
  const shutdown = () => {
    process.stderr.write("Shutting down GraphQL MCP server.\n");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((error) => {
  process.stderr.write(`Fatal error: ${error instanceof Error ? error.stack : error}\n`);
  process.exit(1);
});
