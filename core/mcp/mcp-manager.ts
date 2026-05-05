import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import fs from 'fs/promises';
import { UnifiedLogger } from '../observability/logger.js';
import { ToolDefinition, ToolSchema } from '../types/index.js';

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export interface MCPServerStatus {
  name: string;
  connected: boolean;
  transport: 'stdio' | 'sse' | 'unknown';
  error?: string;
}

export class MCPManager {
  private clients: Map<string, Client> = new Map();
  private errors: Map<string, string> = new Map();
  private config: MCPConfig | null = null;

  constructor(private logger?: UnifiedLogger) {}

  async loadConfig(configPath: string): Promise<void> {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      this.config = JSON.parse(content);
      this.errors.clear();
      this.logger?.logEvent('system', 'mcp_config_loaded', { path: configPath });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger?.logEvent('system', 'mcp_config_missing', { message: 'No mcp-servers.json found. Skipping MCP.' });
        this.config = { mcpServers: {} };
      } else {
        throw new Error(`Failed to load mcp-servers.json: ${error.message}`);
      }
    }
  }

  async connectAll(): Promise<void> {
    if (!this.config) return;
    for (const name of Object.keys(this.config.mcpServers)) {
      await this.connectServer(name);
    }
  }

  async connectServer(name: string): Promise<void> {
    if (!this.config || this.clients.has(name)) return;
    const serverConfig = this.config.mcpServers[name];
    if (!serverConfig) return;

    try {
      let transport;
      if (serverConfig.url) {
        transport = new SSEClientTransport(new URL(serverConfig.url));
      } else if (serverConfig.command) {
        const env: Record<string, string> = {};
        for (const [key, value] of Object.entries(process.env)) {
          if (value !== undefined) env[key] = value;
        }
        if (serverConfig.env) {
          for (const [key, value] of Object.entries(serverConfig.env)) {
            env[key] = value;
          }
        }
        transport = new StdioClientTransport({
          command: serverConfig.command,
          args: serverConfig.args || [],
          env: { ...env, NODE_NO_WARNINGS: '1' },
        });
      } else {
        this.errors.set(name, 'MCP server config has no command or url.');
        return;
      }

      const client = new Client(
        { name: 'bflow-agent-client', version: '1.0.0' },
        { capabilities: {} }
      );
      await client.connect(transport);
      this.clients.set(name, client);
      this.errors.delete(name);
    } catch (error: any) {
      this.errors.set(name, error?.message || String(error));
    }
  }

  getAvailableToolNames(): string[] {
    if (!this.config) return [];
    return Object.keys(this.config.mcpServers);
  }

  getServerStatuses(): MCPServerStatus[] {
    if (!this.config) return [];
    return Object.entries(this.config.mcpServers).map(([name, serverConfig]) => ({
      name,
      connected: this.clients.has(name),
      transport: serverConfig.url ? 'sse' : serverConfig.command ? 'stdio' : 'unknown',
      error: this.errors.get(name),
    }));
  }

  async disconnectServer(name: string): Promise<void> {
    const client = this.clients.get(name);
    if (!client) return;
    try {
      await client.close();
    } finally {
      this.clients.delete(name);
    }
  }

  async getAllTools(): Promise<ToolDefinition[]> {
    const allTools: ToolDefinition[] = [];

    for (const serverName of Object.keys(this.config?.mcpServers || {})) {
      try {
        if (!this.clients.has(serverName)) {
          await this.connectServer(serverName);
        }
        const client = this.clients.get(serverName);
        if (!client) continue;

        const response = await client.listTools();
        for (const mcpTool of response.tools) {
          allTools.push(this.mapMCPToolToDefinition(serverName, client, mcpTool));
        }
      } catch (error: any) {
        this.errors.set(serverName, error?.message || String(error));
      }
    }

    return allTools;
  }

  private mapMCPToolToDefinition(serverName: string, client: Client, mcpTool: MCPTool): ToolDefinition {
    const prefixedName = `${serverName}_${mcpTool.name}`;

    const schema: ToolSchema = {
      name: prefixedName,
      summary: mcpTool.description || `Tool from MCP server ${serverName}`,
      description: mcpTool.description || `Invokes ${mcpTool.name} on server ${serverName}`,
      parameters: mcpTool.inputSchema as any,
      whenToUse: `Use to interact with ${serverName} via ${mcpTool.name}.`,
      expectedOutput: 'Server execution result.',
      failureModes: ['Connection timeout', 'Invalid arguments', 'Remote server error'],
      recoverableErrors: [],
      examples: [],
      dangerous: true,
    };

    return {
      schema,
      execute: async (args: any, _context: any) => {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: args,
        });
        return result;
      },
    };
  }

  async shutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.close();
      } catch {
        // Ignore shutdown errors.
      }
    }
    this.clients.clear();
  }
}
