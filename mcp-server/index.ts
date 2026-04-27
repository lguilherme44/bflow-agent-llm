/**
 * MCP Server for bflow-agent-llm — exposes SaaS APIs as MCP tools.
 *
 * This server bridges the agent with the bflowbarber-app SaaS backend,
 * allowing the agent to manage clients, appointments, and communications.
 *
 * Usage:
 *   Add to mcp-servers.json:
 *   {
 *     "bflow-saas": {
 *       "command": "node",
 *       "args": ["dist/mcp-server/index.js"],
 *       "env": { "SAAS_API_URL": "http://localhost:3001", "SAAS_API_KEY": "your-key" }
 *     }
 *   }
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

const SAAS_API_URL = process.env.SAAS_API_URL || 'http://localhost:3001';
const SAAS_API_KEY = process.env.SAAS_API_KEY || '';

async function saasFetch(path: string, options: RequestInit = {}): Promise<unknown> {
  const res = await fetch(`${SAAS_API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SAAS_API_KEY}`,
      ...options.headers,
    },
  });
  if (!res.ok) {
    throw new Error(`SaaS API error ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

// ── Tool Definitions ──────────────────────────────────────────

const TOOLS: Tool[] = [
  {
    name: 'bflow_list_clients',
    description: 'Lista todos os clientes da barbearia com paginação.',
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', description: 'Página (default: 1)' },
        limit: { type: 'integer', description: 'Itens por página (default: 20)' },
        search: { type: 'string', description: 'Termo de busca por nome/email' },
      },
    },
  },
  {
    name: 'bflow_get_client',
    description: 'Obtém detalhes de um cliente específico.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'ID do cliente' },
      },
      required: ['id'],
    },
  },
  {
    name: 'bflow_list_appointments',
    description: 'Lista agendamentos com filtros por data, status e barbeiro.',
    inputSchema: {
      type: 'object',
      properties: {
        date: { type: 'string', description: 'Data no formato YYYY-MM-DD' },
        status: { type: 'string', enum: ['pending', 'confirmed', 'completed', 'cancelled'] },
        barberId: { type: 'string', description: 'ID do barbeiro' },
        page: { type: 'integer' },
        limit: { type: 'integer' },
      },
    },
  },
  {
    name: 'bflow_get_appointment',
    description: 'Obtém detalhes de um agendamento.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
  {
    name: 'bflow_get_dashboard_stats',
    description: 'Obtém estatísticas do dashboard da barbearia (faturamento, agendamentos, etc).',
    inputSchema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month', 'year'], description: 'Período' },
      },
    },
  },
  {
    name: 'bflow_list_services',
    description: 'Lista todos os serviços oferecidos pela barbearia.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'bflow_list_barbers',
    description: 'Lista todos os barbeiros da barbearia.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ── Server ─────────────────────────────────────────────────────

const server = new Server(
  { name: 'bflow-saas-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'bflow_list_clients': {
        const params = new URLSearchParams();
        if (args?.page) params.set('page', String(args.page));
        if (args?.limit) params.set('limit', String(args.limit));
        if (args?.search) params.set('search', String(args.search));
        const data = await saasFetch(`/api/clients?${params}`);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      case 'bflow_get_client': {
        const data = await saasFetch(`/api/clients/${args?.id}`);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      case 'bflow_list_appointments': {
        const params = new URLSearchParams();
        if (args?.date) params.set('date', String(args.date));
        if (args?.status) params.set('status', String(args.status));
        if (args?.barberId) params.set('barberId', String(args.barberId));
        if (args?.page) params.set('page', String(args.page));
        if (args?.limit) params.set('limit', String(args.limit));
        const data = await saasFetch(`/api/appointments?${params}`);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      case 'bflow_get_appointment': {
        const data = await saasFetch(`/api/appointments/${args?.id}`);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      case 'bflow_get_dashboard_stats': {
        const period = args?.period || 'today';
        const data = await saasFetch(`/api/dashboard/stats?period=${period}`);
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      case 'bflow_list_services': {
        const data = await saasFetch('/api/services');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      case 'bflow_list_barbers': {
        const data = await saasFetch('/api/barbers');
        return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
