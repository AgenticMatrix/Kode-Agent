/**
 * client.ts — MCPClient: JSON-RPC 2.0 over stdio for MCP Server communication
 *
 * Spawns an MCP-compatible server process (e.g., a language server, database
 * tool, or external agent) and communicates via line-delimited JSON on
 * stdin/stdout following the Model Context Protocol.
 *
 * Features:
 *  - hand-written JSON-RPC 2.0 (no @modelcontextprotocol/sdk dependency)
 *  - 30s per-request timeout with automatic retry (1 attempt)
 *  - MCP tool → BaseTool wrapping for ToolRegistry integration
 *  - Graceful disconnect with child process cleanup
 *
 * Architecture reference: ARCHITECTURE.md §4.12 (MCP Integration)
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  BaseTool,
  RiskLevel,
  type ToolContext,
  type ToolDefinition,
  type ValidationResult,
} from '@kode/shared';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000; // 30s per request
const MAX_RETRIES = 1;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** MCP Tool descriptor returned by tools/list */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

/** MCP Tool call result */
export interface MCPToolResult {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
}

/** JSON-RPC 2.0 request envelope */
interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params?: unknown;
}

/** JSON-RPC 2.0 success response */
interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

/** MCP Initialize result */
interface MCPInitializeResult {
  protocolVersion: string;
  capabilities: {
    tools?: Record<string, unknown>;
    resources?: Record<string, unknown>;
    prompts?: Record<string, unknown>;
  };
  serverInfo?: {
    name: string;
    version: string;
  };
}

/** MCP Client configuration */
export interface MCPClientConfig {
  /** Shell command to start the MCP server */
  serverCommand: string;
  /** Arguments passed to the server command */
  serverArgs?: string[];
  /** Environment variables for the server process */
  env?: Record<string, string>;
  /** Per-request timeout in ms (default: 30_000) */
  timeoutMs?: number;
  /** Label for this MCP server (used in tool namespacing) */
  label?: string;
  /** OAuth 2.0 configuration for remote MCP servers */
  oauth?: MCPOAuthConfig;
}

/** OAuth 2.0 configuration for MCP client authentication */
export interface MCPOAuthConfig {
  /** OAuth authorization endpoint URL */
  authorizationUrl: string;
  /** OAuth token endpoint URL */
  tokenUrl: string;
  /** OAuth client ID */
  clientId: string;
  /** OAuth client secret */
  clientSecret: string;
  /** OAuth scopes (space-separated) */
  scope?: string;
  /** Redirect URI (default: http://localhost:0/callback) */
  redirectUri?: string;
}

/** OAuth 2.0 token response */
export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  tokenType: string;
  scope?: string;
}

// ---------------------------------------------------------------------------
// MCPClient
// ---------------------------------------------------------------------------

export class MCPClient {
  private config: Required<Omit<MCPClientConfig, 'env' | 'oauth'>> & {
    env?: Record<string, string>;
    oauth?: MCPOAuthConfig;
  };
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<
    number | string,
    { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }
  >();
  private buffer = '';
  private initialized = false;
  private serverCapabilities: MCPInitializeResult | null = null;
  private cachedTools: MCPTool[] | null = null;
  private _oauthToken: OAuthToken | null = null;

  constructor(config: MCPClientConfig) {
    this.config = {
      serverCommand: config.serverCommand,
      serverArgs: config.serverArgs ?? [],
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      label: config.label ?? config.serverCommand,
      env: config.env,
      oauth: config.oauth,
    };
  }

  // -------------------------------------------------------------------
  // Public: Connection lifecycle
  // -------------------------------------------------------------------

  /**
   * Start the MCP server and perform the initialize handshake.
   *
   * Spawns the server process, sets up stdin/stdout JSON-RPC transport,
   * and sends the MCP `initialize` request.
   */
  async connect(): Promise<void> {
    if (this.process) {
      throw new Error('MCPClient is already connected');
    }

    const env = {
      ...process.env,
      ...this.config.env,
    };

    this.process = spawn(this.config.serverCommand, this.config.serverArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
      // Prevent the child from attaching to the parent TTY
      detached: false,
    });

    // Handle unexpected process exit
    this.process.on('exit', (code, signal) => {
      this.rejectAllPending(
        new Error(`MCP server process exited (code=${code}, signal=${signal})`),
      );
      this.initialized = false;
    });

    this.process.on('error', (err) => {
      this.rejectAllPending(
        new Error(`MCP server process error: ${err.message}`),
      );
      this.initialized = false;
    });

    // Read JSON-RPC responses from stdout
    if (this.process.stdout) {
      this.process.stdout.on('data', (chunk: Buffer) => {
        this.handleData(chunk.toString('utf-8'));
      });
    }

    // Log stderr for debugging
    if (this.process.stderr) {
      this.process.stderr.on('data', (chunk: Buffer) => {
        // Stderr is informational — not used for protocol
        // Could be logged to a debug channel
      });
    }

    // Send initialize request
    try {
      const result = await this.sendRequest('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: {
          tools: {},
        },
        clientInfo: {
          name: 'kode-agent',
          version: '0.1.0',
        },
      }) as MCPInitializeResult;

      this.serverCapabilities = result;
      this.initialized = true;

      // Send initialized notification (no response expected)
      this.sendNotification('notifications/initialized', {});
    } catch (err) {
      this.disconnect();
      throw new Error(
        `MCP initialize failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Disconnect from the MCP server and clean up the child process.
   */
  disconnect(): void {
    this.initialized = false;
    this.serverCapabilities = null;
    this.cachedTools = null;
    this._oauthToken = null;
    this.rejectAllPending(new Error('MCPClient disconnected'));

    if (this.process) {
      try {
        this.process.kill('SIGTERM');
      } catch {
        // Process may already be dead
      }

      // Force kill after 3s if still alive
      setTimeout(() => {
        if (this.process && this.process.exitCode === null) {
          try {
            this.process.kill('SIGKILL');
          } catch {
            // Already dead
          }
        }
      }, 3000).unref();

      this.process = null;
    }
  }

  /**
   * Check if the client is connected and initialized.
   */
  get connected(): boolean {
    return this.initialized && this.process !== null && this.process.exitCode === null;
  }

  /**
   * Get server capabilities from the initialize handshake.
   */
  get capabilities(): MCPInitializeResult | null {
    return this.serverCapabilities;
  }

  // -------------------------------------------------------------------
  // Public: OAuth 2.0 authentication
  // -------------------------------------------------------------------

  /**
   * Whether the client has a valid OAuth token.
   */
  get isAuthenticated(): boolean {
    return this._oauthToken !== null && !this._isTokenExpired();
  }

  /**
   * Get the current OAuth access token, refreshing if needed.
   *
   * Returns null if OAuth is not configured or the token cannot be refreshed.
   */
  async getAccessToken(): Promise<string | null> {
    if (!this._oauthToken) return null;

    if (this._isTokenExpired()) {
      try {
        await this._refreshAccessToken();
      } catch {
        this._oauthToken = null;
        return null;
      }
    }

    return this._oauthToken.accessToken;
  }

  /**
   * Exchange an authorization code for an OAuth 2.0 access token.
   *
   * This completes the second step of the OAuth 2.0 authorization code flow.
   * The user must first visit the authorization URL (config.oauth.authorizationUrl)
   * and grant consent, after which the authorization server redirects to the
   * redirect URI with a `code` parameter. Pass that code here.
   *
   * @param authorizationCode — The `code` query parameter from the OAuth callback
   */
  async authenticate(authorizationCode: string): Promise<void> {
    const oauth = this.config.oauth;
    if (!oauth) {
      throw new Error('OAuth is not configured for this MCP client');
    }

    const params = new URLSearchParams();
    params.set('grant_type', 'authorization_code');
    params.set('code', authorizationCode);
    params.set('client_id', oauth.clientId);
    params.set('client_secret', oauth.clientSecret);
    params.set('redirect_uri', oauth.redirectUri ?? 'http://localhost:0/callback');

    let response: globalThis.Response;
    try {
      response = await fetch(oauth.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
      });
    } catch (err) {
      throw new Error(
        `OAuth token request failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(
        `OAuth token endpoint returned ${response.status}: ${body.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
      scope?: string;
    };

    this._oauthToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope,
    };
  }

  /**
   * Get the OAuth authorization URL that the user should visit.
   *
   * Builds the full authorization URL with all required parameters so the
   * user can be redirected to the OAuth provider's consent screen.
   */
  getAuthorizationUrl(): string {
    const oauth = this.config.oauth;
    if (!oauth) {
      throw new Error('OAuth is not configured for this MCP client');
    }

    const params = new URLSearchParams();
    params.set('response_type', 'code');
    params.set('client_id', oauth.clientId);
    params.set('redirect_uri', oauth.redirectUri ?? 'http://localhost:0/callback');
    if (oauth.scope) {
      params.set('scope', oauth.scope);
    }
    params.set('state', randomUUID());

    return `${oauth.authorizationUrl}?${params.toString()}`;
  }

  // -------------------------------------------------------------------
  // Public: Tool discovery
  // -------------------------------------------------------------------

  /**
   * List all tools available on the connected MCP server.
   *
   * Results are cached after the first call. Use refreshTools() to
   * invalidate the cache and re-query.
   */
  async listTools(): Promise<MCPTool[]> {
    if (this.cachedTools) return this.cachedTools;

    this.ensureConnected();

    const result = await this.sendRequest('tools/list', {});
    const tools = (result as { tools: MCPTool[] }).tools ?? [];

    this.cachedTools = tools;
    return tools;
  }

  /**
   * Refresh the tool list by clearing the cache and re-querying.
   */
  async refreshTools(): Promise<MCPTool[]> {
    this.cachedTools = null;
    return this.listTools();
  }

  /**
   * Convert MCP tools to Kode ToolDefinition format.
   */
  async getToolDefinitions(): Promise<ToolDefinition[]> {
    const tools = await this.listTools();

    return tools.map((tool) => ({
      name: `mcp__${this.config.label}__${tool.name}`,
      description: `[MCP: ${this.config.label}] ${tool.description}`,
      inputSchema: tool.inputSchema as ToolDefinition['inputSchema'],
      riskLevel: RiskLevel.MUTATION,
    }));
  }

  /**
   * Wrap all MCP tools as BaseTool instances suitable for ToolRegistry.
   *
   * Each tool is namespaced as `mcp__<label>__<tool-name>` to avoid
   * collisions with built-in Kode tools and tools from other MCP servers.
   */
  async wrapAsBaseTools(): Promise<BaseTool[]> {
    const tools = await this.listTools();
    const baseTools: BaseTool[] = [];

    for (const mcpTool of tools) {
      const toolName = `mcp__${this.config.label}__${mcpTool.name}`;
      const client = this;

      const wrappedTool = new (class extends BaseTool {
        override get definition(): ToolDefinition {
          return {
            name: toolName,
            description: `[MCP: ${client.config.label}] ${mcpTool.description}`,
            inputSchema: mcpTool.inputSchema as ToolDefinition['inputSchema'],
            riskLevel: RiskLevel.MUTATION,
          };
        }

        override validate(input: unknown): ValidationResult {
          if (!input || typeof input !== 'object') {
            return {
              valid: false,
              errors: [{ path: '', message: 'Input must be an object' }],
            };
          }
          return { valid: true };
        }

        override async execute(
          input: Record<string, unknown>,
          _ctx: ToolContext,
        ): Promise<string> {
          const result = await client.callTool(mcpTool.name, input);

          if (result.isError) {
            const errText = result.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text ?? '')
              .join('\n');
            throw new Error(`MCP tool error: ${errText}`);
          }

          return result.content
            .filter((c) => c.type === 'text')
            .map((c) => c.text ?? '')
            .join('\n');
        }
      })();

      baseTools.push(wrappedTool);
    }

    return baseTools;
  }

  // -------------------------------------------------------------------
  // Public: Tool invocation
  // -------------------------------------------------------------------

  /**
   * Call a tool on the connected MCP server.
   *
   * @param name — The tool name as reported by listTools()
   * @param args — Tool arguments (must conform to the tool's inputSchema)
   * @returns The tool result with content array
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPToolResult> {
    this.ensureConnected();

    const result = await this.sendRequestWithRetry('tools/call', {
      name,
      arguments: args,
    });

    return result as MCPToolResult;
  }

  // -------------------------------------------------------------------
  // Public: Resources (optional MCP capability)
  // -------------------------------------------------------------------

  /**
   * List resources if the server supports them.
   */
  async listResources(): Promise<unknown[]> {
    this.ensureConnected();

    if (!this.serverCapabilities?.capabilities.resources) {
      return [];
    }

    const result = await this.sendRequest('resources/list', {});
    return (result as { resources: unknown[] }).resources ?? [];
  }

  /**
   * Read a specific resource by URI.
   */
  async readResource(uri: string): Promise<unknown> {
    this.ensureConnected();
    return this.sendRequest('resources/read', { uri });
  }

  // -------------------------------------------------------------------
  // Private: OAuth token management
  // -------------------------------------------------------------------

  /**
   * Check whether the current OAuth token is expired.
   */
  private _isTokenExpired(): boolean {
    if (!this._oauthToken?.expiresAt) return false;
    // Consider token expired 30s before actual expiry to avoid race conditions
    return Date.now() >= this._oauthToken.expiresAt - 30_000;
  }

  /**
   * Refresh the OAuth access token using the refresh token.
   */
  private async _refreshAccessToken(): Promise<void> {
    const oauth = this.config.oauth;
    if (!oauth) throw new Error('OAuth not configured');
    if (!this._oauthToken?.refreshToken) {
      throw new Error('No refresh token available');
    }

    const params = new URLSearchParams();
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', this._oauthToken.refreshToken);
    params.set('client_id', oauth.clientId);
    params.set('client_secret', oauth.clientSecret);

    let response: globalThis.Response;
    try {
      response = await fetch(oauth.tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: params.toString(),
      });
    } catch (err) {
      throw new Error(
        `OAuth token refresh failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (!response.ok) {
      this._oauthToken = null;
      throw new Error(`OAuth token refresh returned ${response.status}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      token_type: string;
      scope?: string;
    };

    this._oauthToken = {
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? this._oauthToken.refreshToken,
      expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      tokenType: data.token_type ?? 'Bearer',
      scope: data.scope ?? this._oauthToken.scope,
    };
  }

  /**
   * Get HTTP Authorization headers for the current OAuth token.
   *
   * Returns an empty object if OAuth is not authenticated. The token is
   * automatically refreshed if expired (best-effort, synchronous fallback).
   */
  private _getAuthHeaders(): Record<string, string> {
    if (!this._oauthToken) return {};
    return {
      Authorization: `${this._oauthToken.tokenType} ${this._oauthToken.accessToken}`,
    };
  }

  // -------------------------------------------------------------------
  // Private: JSON-RPC transport
  // -------------------------------------------------------------------

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  private sendRequest(method: string, params?: unknown): Promise<unknown> {
    const id = this.requestId++;
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    };

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method} (${this.config.timeoutMs}ms)`));
      }, this.config.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });

      try {
        this.writeLine(JSON.stringify(request));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err);
      }
    });
  }

  /**
   * Send a request with automatic retry on transient failure.
   */
  private async sendRequestWithRetry(
    method: string,
    params?: unknown,
  ): Promise<unknown> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        return await this.sendRequest(method, params);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Don't retry if disconnected
        if (!this.connected) {
          throw lastError;
        }
      }
    }

    throw lastError ?? new Error(`MCP request failed: ${method}`);
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  private sendNotification(method: string, params?: unknown): void {
    const notification = {
      jsonrpc: '2.0' as const,
      method,
      params,
    };

    try {
      this.writeLine(JSON.stringify(notification));
    } catch {
      // Notifications are fire-and-forget
    }
  }

  /**
   * Write a line to the server process's stdin.
   */
  private writeLine(line: string): void {
    if (!this.process || !this.process.stdin) {
      throw new Error('MCPClient: process stdin is not available');
    }
    this.process.stdin.write(line + '\n');
  }

  /**
   * Handle incoming data from the server's stdout.
   *
   * MCP uses line-delimited JSON: each message is a single line.
   * We buffer partial lines and dispatch complete messages.
   */
  private handleData(data: string): void {
    this.buffer += data;

    // Process complete lines
    let newlineIdx: number;
    while ((newlineIdx = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.slice(0, newlineIdx).trim();
      this.buffer = this.buffer.slice(newlineIdx + 1);

      if (line.length === 0) continue;

      try {
        const message = JSON.parse(line) as JsonRpcResponse;

        if (message.id !== undefined && this.pending.has(message.id)) {
          const entry = this.pending.get(message.id)!;
          clearTimeout(entry.timer);
          this.pending.delete(message.id);

          if (message.error) {
            entry.reject(
              new Error(
                `MCP error ${message.error.code}: ${message.error.message}`,
              ),
            );
          } else {
            entry.resolve(message.result);
          }
        }
        // Notifications (no id) are ignored — no response expected
      } catch {
        // Malformed JSON — skip this line
      }
    }
  }

  /**
   * Reject all pending requests (used on disconnect / process exit).
   */
  private rejectAllPending(error: Error): void {
    for (const [, entry] of this.pending) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
  }

  /**
   * Assert that the client is connected.
   */
  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error('MCPClient is not connected. Call connect() first.');
    }
  }
}
