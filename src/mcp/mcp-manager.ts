import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Tool as MCPTool } from "@modelcontextprotocol/sdk/types.js";
import fs from 'fs/promises';
import { UnifiedLogger } from '../observability/logger.js';
import { ToolDefinition, ToolSchema } from '../types/index.js';

export interface MCPServerConfig {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string; // Para SSE
}

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export class MCPManager {
  private clients: Map<string, Client> = new Map();
  private config: MCPConfig | null = null;

  constructor(private logger?: UnifiedLogger) {}

  async loadConfig(configPath: string): Promise<void> {
    try {
      const content = await fs.readFile(configPath, 'utf-8');
      this.config = JSON.parse(content);
      this.logger?.logEvent('system', 'mcp_config_loaded', { path: configPath });
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        this.logger?.logEvent('system', 'mcp_config_missing', { message: 'Nenhum arquivo mcp-servers.json encontrado. Pulando MCP.' });
        this.config = { mcpServers: {} };
      } else {
        throw new Error(`Falha ao carregar mcp-servers.json: ${error.message}`);
      }
    }
  }

  async connectAll(): Promise<void> {
    if (!this.config) return;

    for (const [name, serverConfig] of Object.entries(this.config.mcpServers)) {
      try {
        let transport;
        if (serverConfig.url) {
          transport = new SSEClientTransport(new URL(serverConfig.url));
        } else if (serverConfig.command) {
          const env: Record<string, string> = {};
          // Copiar variáveis do processo (filtrando as que são undefined)
          for (const [key, value] of Object.entries(process.env)) {
            if (value !== undefined) env[key] = value;
          }
          // Sobrescrever com variáveis da config
          if (serverConfig.env) {
            for (const [key, value] of Object.entries(serverConfig.env)) {
              env[key] = value;
            }
          }

          transport = new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args || [],
            env
          });
        } else {
          this.logger?.logEvent('system', 'mcp_server_skip', { name, reason: 'Servidor MCP sem comando ou URL' });
          continue;
        }

        const client = new Client(
          { name: "bflow-agent-client", version: "1.0.0" },
          { capabilities: {} }
        );

        await client.connect(transport);
        this.clients.set(name, client);
        this.logger?.logEvent('system', 'mcp_server_connected', { name });
      } catch (error: any) {
        this.logger?.logEvent('system', 'mcp_server_error', { name, error: error.message });
      }
    }
  }

  async getAllTools(): Promise<ToolDefinition[]> {
    const allTools: ToolDefinition[] = [];

    for (const [serverName, client] of this.clients.entries()) {
      try {
        const response = await client.listTools();
        for (const mcpTool of response.tools) {
          allTools.push(this.mapMCPToolToDefinition(serverName, client, mcpTool));
        }
      } catch (error: any) {
        this.logger?.logEvent('system', 'mcp_tool_list_error', { serverName, error: error.message });
      }
    }

    return allTools;
  }

  private mapMCPToolToDefinition(serverName: string, client: Client, mcpTool: MCPTool): ToolDefinition {
    // Prefixamos o nome da tool para evitar colisões (ex: github_create_issue)
    const prefixedName = `${serverName}_${mcpTool.name}`;

    const schema: ToolSchema = {
      name: prefixedName,
      summary: mcpTool.description || `Ferramenta do servidor MCP ${serverName}`,
      description: mcpTool.description || `Invoca ${mcpTool.name} no servidor ${serverName}`,
      parameters: mcpTool.inputSchema as any,
      whenToUse: `Use para interagir com ${serverName} via ${mcpTool.name}.`,
      expectedOutput: "Resultado da execução no servidor MCP.",
      failureModes: ["Timeout de conexão", "Argumentos inválidos", "Erro no servidor remoto"],
      recoverableErrors: [],
      examples: [],
      dangerous: true // Por segurança, ferramentas externas são marcadas como perigosas para HITL
    };

    return {
      schema,
      execute: async (args: any, _context: any) => {
        const result = await client.callTool({
          name: mcpTool.name,
          arguments: args
        });
        return result;
      }
    };
  }

  async shutdown(): Promise<void> {
    for (const client of this.clients.values()) {
      try {
        await client.close();
      } catch (error: any) {
        // Ignorar erros no fechamento
      }
    }
    this.clients.clear();
  }
}
