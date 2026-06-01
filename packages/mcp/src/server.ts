/**
 * server.ts — MCPServer: Expose Kode Agent tools over MCP (Model Context Protocol)
 *
 * Implements the MCP server protocol over stdio transport. Reads JSON-RPC 2.0
 * requests from stdin and writes responses to stdout. Compatible with any MCP
 * host (Claude Desktop, Continue, Cursor, etc.).
 *
 * Supported methods:
 *  - initialize    → returns server capabilities
 *  - tools/list    → returns ToolRegistry.getDefinitions() in MCP format
 *  - tools/call    → executes a tool via ToolRegistry and returns the result
 *
 * The tool provider is injected via constructor — the concrete ToolRegistry
 * from @kode/core satisfies the IToolProvider interface.
 *
 * Architecture reference: ARCHITECTURE.md §4.12 (MCP Integration)
 */

import { Readable, Writable } from 'node:stream';
import type { ToolDefinition, ToolContext, ToolExecutionResult } from '@kode/shared';

// ---------------------------------------------------------------------------
// Tool Provider Interface (dependency-injected, satisfied by ToolRegistry)
// ---------------------------------------------------------------------------

/**
 * Minimal interface for looking up and executing tools.
 *
 * ToolRegistry from @kode/core satisfies this interface:
 *  - get(name): returns { definition, instance } where instance.execute(input, ctx)
 *  - getDefinitions(): returns ToolDefinition[]
 */
export interface IToolProvider {
  get(name: string): { definition: ToolDefinition; instance: { execute(input: unknown, ctx: ToolContext): Promise<unknown> } } | undefined;
  getDefinitions(): ToolDefinition[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'kode-agent-mcp';
const SERVER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface JsonRpcMessage {
  jsonrpc: '2.0';
  id?: number | string;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface MCPToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

interface MCPCallToolResult {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
}

// ---------------------------------------------------------------------------
// MCPServer
// ---------------------------------------------------------------------------

/** MCP Resource descriptor */
export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  content: string | (() => string | Promise<string>);
}

export class MCPServer {
  private toolProvider: IToolProvider;
  private input: Readable;
  private output: Writable;
  private initialized = false;
  private buffer = '';
  private running = false;
  private resources: Map<string, MCPResource> = new Map();

  /**
   * @param toolProvider — ToolRegistry or compatible provider
   * @param input — Readable stream (default: process.stdin)
   * @param output — Writable stream (default: process.stdout)
   */
  constructor(
    toolProvider: IToolProvider,
    input?: Readable,
    output?: Writable,
  ) {
    this.toolProvider = toolProvider;
    this.input = input ?? process.stdin;
    this.output = output ?? process.stdout;
  }

  // -------------------------------------------------------------------
  // Public: Resource registration
  // -------------------------------------------------------------------

  /**
   * Register an MCP resource that can be listed and read by clients.
   *
   * @param resource — Resource descriptor with URI, name, and content.
   *   Content can be a static string or a lazy function that returns a string.
   */
  registerResource(resource: MCPResource): void {
    this.resources.set(resource.uri, resource);
  }

  /**
   * Unregister a previously registered resource.
   */
  unregisterResource(uri: string): boolean {
    return this.resources.delete(uri);
  }

  /**
   * Get all registered resources.
   */
  listResources(): MCPResource[] {
    return Array.from(this.resources.values());
  }

  // -------------------------------------------------------------------
  // Public: Lifecycle
  // -------------------------------------------------------------------

  /**
   * Start listening for JSON-RPC requests on stdin.
   *
   * Sets up data listeners and processes incoming messages until the
   * input stream ends or an error occurs.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.input.setEncoding('utf-8');

    this.input.on('data', (chunk: string) => {
      this.handleData(chunk);
    });

    this.input.on('end', () => {
      this.running = false;
    });

    this.input.on('error', (err: Error) => {
      this.running = false;
      // Write error to stderr (don't corrupt the stdout protocol channel)
      process.stderr.write(`MCPServer input error: ${err.message}\n`);
    });
  }

  /**
   * Stop the server gracefully.
   */
  stop(): void {
    this.running = false;
    // stdin is typically not closeable from this side in a stdio server,
    // but we can stop processing further data
  }

  // -------------------------------------------------------------------
  // Private: Message handling
  // -------------------------------------------------------------------

  private handleData(data: string): void {
    this.buffer += data;

    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (line.length === 0) continue;

      this.processMessage(line).catch((err: Error) => {
        // Unhandled error — write to stderr to avoid corrupting the channel
        process.stderr.write(`MCPServer error: ${err.message}\n`);
      });
    }
  }

  private async processMessage(line: string): Promise<void> {
    let message: JsonRpcMessage;

    try {
      message = JSON.parse(line) as JsonRpcMessage;
    } catch {
      this.sendError(null, -32700, 'Parse error: invalid JSON');
      return;
    }

    // Notifications have no id — no response needed
    if (message.id === undefined) {
      await this.handleNotification(message);
      return;
    }

    // Request with method
    if (!message.method) {
      this.sendError(message.id, -32600, 'Invalid Request: missing method');
      return;
    }

    await this.handleRequest(message);
  }

  private async handleRequest(message: JsonRpcMessage): Promise<void> {
    const { id, method } = message;
    if (id === undefined) return;

    try {
      switch (method) {
        case 'initialize':
          await this.handleInitialize(id, message.params);
          break;

        case 'tools/list':
          if (!this.initialized) {
            this.sendError(id, -32002, 'Not initialized. Send initialize first.');
            return;
          }
          await this.handleToolsList(id);
          break;

        case 'tools/call':
          if (!this.initialized) {
            this.sendError(id, -32002, 'Not initialized. Send initialize first.');
            return;
          }
          await this.handleToolsCall(id, message.params);
          break;

        case 'resources/list':
          if (!this.initialized) {
            this.sendError(id, -32002, 'Not initialized.');
            return;
          }
          await this.handleResourcesList(id);
          break;

        case 'resources/read':
          if (!this.initialized) {
            this.sendError(id, -32002, 'Not initialized.');
            return;
          }
          await this.handleResourcesRead(id, message.params);
          break;

        case 'prompts/list':
          if (!this.initialized) {
            this.sendError(id, -32002, 'Not initialized.');
            return;
          }
          this.sendResult(id, { prompts: [] });
          break;

        default:
          this.sendError(id, -32601, `Method not found: ${method}`);
      }
    } catch (err) {
      this.sendError(
        id,
        -32603,
        `Internal error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private async handleNotification(message: JsonRpcMessage): Promise<void> {
    // Handle notifications that don't require a response
    if (message.method === 'notifications/initialized') {
      // Client acknowledged initialization — no action needed
    }
    // Other notifications are silently ignored
  }

  // -------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------

  private async handleInitialize(
    id: number | string,
    _params: unknown,
  ): Promise<void> {
    this.initialized = true;

    this.sendResult(id, {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {
        tools: {},
        resources: {},
      },
      serverInfo: {
        name: SERVER_NAME,
        version: SERVER_VERSION,
      },
    });
  }

  private async handleToolsList(id: number | string): Promise<void> {
    const definitions = this.toolProvider.getDefinitions();

    const tools: MCPToolDefinition[] = definitions.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: {
        type: 'object' as const,
        properties: def.inputSchema.properties ?? {},
        required: def.inputSchema.required,
      },
    }));

    this.sendResult(id, { tools });
  }

  private async handleToolsCall(
    id: number | string,
    params: unknown,
  ): Promise<void> {
    const p = params as { name?: string; arguments?: Record<string, unknown> } | undefined;

    if (!p?.name) {
      this.sendError(id, -32602, 'Invalid params: name is required');
      return;
    }

    const entry = this.toolProvider.get(p.name);
    if (!entry) {
      this.sendError(id, -32602, `Tool not found: ${p.name}`);
      return;
    }

    const input = p.arguments ?? {};

    try {
      const ctx: ToolContext = {
        sessionId: 'mcp-server',
        cwd: process.cwd(),
      };

      const result: unknown = await entry.instance.execute(input, ctx);
      const outputText =
        typeof result === 'string'
          ? result
          : JSON.stringify(result, null, 2);

      const mcpResult: MCPCallToolResult = {
        content: [{ type: 'text', text: outputText }],
      };

      this.sendResult(id, mcpResult);
    } catch (err) {
      const errorMessage =
        err instanceof Error ? err.message : String(err);

      // Return error as tool result content (MCP convention), not as JSON-RPC error
      const mcpResult: MCPCallToolResult = {
        content: [{ type: 'text', text: `Error: ${errorMessage}` }],
        isError: true,
      };

      this.sendResult(id, mcpResult);
    }
  }

  private async handleResourcesList(id: number | string): Promise<void> {
    const resourceList = Array.from(this.resources.values()).map((r) => ({
      uri: r.uri,
      name: r.name,
      description: r.description,
      mimeType: r.mimeType,
    }));

    this.sendResult(id, { resources: resourceList });
  }

  private async handleResourcesRead(
    id: number | string,
    params: unknown,
  ): Promise<void> {
    const p = params as { uri?: string } | undefined;

    if (!p?.uri) {
      this.sendError(id, -32602, 'Invalid params: uri is required');
      return;
    }

    const resource = this.resources.get(p.uri);
    if (!resource) {
      this.sendError(id, -32602, `Resource not found: ${p.uri}`);
      return;
    }

    try {
      const content =
        typeof resource.content === 'function'
          ? await resource.content()
          : resource.content;

      this.sendResult(id, {
        contents: [
          {
            uri: resource.uri,
            mimeType: resource.mimeType ?? 'text/plain',
            text: content,
          },
        ],
      });
    } catch (err) {
      this.sendError(
        id,
        -32603,
        `Failed to read resource: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // -------------------------------------------------------------------
  // Transport: Write JSON-RPC messages to stdout
  // -------------------------------------------------------------------

  private sendResult(id: number | string, result: unknown): void {
    const response: JsonRpcMessage = {
      jsonrpc: '2.0',
      id,
      result,
    };
    this.writeLine(JSON.stringify(response));
  }

  private sendError(
    id: number | string | null,
    code: number,
    message: string,
  ): void {
    const response: JsonRpcMessage = {
      jsonrpc: '2.0',
      id: id ?? null as unknown as number,
      error: { code, message },
    };
    this.writeLine(JSON.stringify(response));
  }

  private writeLine(line: string): void {
    try {
      this.output.write(line + '\n');
    } catch {
      // Output stream closed — stop the server
      this.running = false;
    }
  }
}
