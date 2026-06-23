/**
 * MCP server factory.
 *
 * Creates the McpServer instance, sets up shared context, and registers
 * all tool categories. This is the central wiring point — the entry
 * point in index.ts just calls this and starts the transport.
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ServerContext, configFromEnv, type ServerContextOptions } from "./context.js";
import { registerConnectionTools } from "./tools/connection.js";
import { registerSchemaTools } from "./tools/schema.js";
import { registerExecuteTools } from "./tools/execute.js";
import { registerCacheTools } from "./tools/cache.js";

export interface ServerOptions extends ServerContextOptions {}

export function createServer(options?: ServerOptions): { server: McpServer; ctx: ServerContext } {
  const ctx = new ServerContext();

  // Apply env defaults first, then explicit options override
  const envConfig = configFromEnv();
  const merged: ServerContextOptions = {
    endpoint: options?.endpoint ?? envConfig.endpoint,
    headers: options?.headers ?? envConfig.headers,
    authToken: options?.authToken ?? envConfig.authToken,
    basicAuth: options?.basicAuth ?? envConfig.basicAuth,
    timeoutMs: options?.timeoutMs ?? envConfig.timeoutMs,
  };

  if (merged.endpoint) {
    try {
      ctx.configure(merged);
    } catch (error) {
      process.stderr.write(`Warning: failed to configure endpoint at startup: ${error}\n`);
    }
  }

  const server = new McpServer({
    name: "graphql-mcp-server",
    version: "0.1.0",
  });

  registerConnectionTools(server, ctx);
  registerSchemaTools(server, ctx);
  registerExecuteTools(server, ctx);
  registerCacheTools(server, ctx);

  return { server, ctx };
}
