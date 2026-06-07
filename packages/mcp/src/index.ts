/**
 * @coder/mcp — Coder Agent MCP Integration
 *
 * JSON-RPC 2.0 over stdio for Model Context Protocol communication.
 * Architecture reference: ARCHITECTURE.md §4.12
 */

export { MCPClient } from './client.js';
export type {
  MCPClientConfig,
  MCPTool,
  MCPToolResult,
  MCPOAuthConfig,
  OAuthToken,
} from './client.js';

export { MCPServer } from './server.js';
export type { IToolProvider, MCPResource } from './server.js';
