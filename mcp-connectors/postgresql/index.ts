/**
 * PostgreSQL MCP Connector — query, analyze, and manage PostgreSQL databases.
 *
 * Usage in mcp-servers.json:
 * { "postgres": { "command": "node", "args": ["dist/mcp-connectors/postgresql/index.js"],
 *   "env": { "PGHOST": "localhost", "PGPORT": "5432", "PGDATABASE": "mydb",
 *            "PGUSER": "postgres", "PGPASSWORD": "secret" } } }
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { Client } from 'pg';

function getClient(): Client {
  return new Client({
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT) || 5432,
    database: process.env.PGDATABASE || 'postgres',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || '',
    connectionTimeoutMillis: 10000,
  });
}

const TOOLS: Tool[] = [
  {
    name: 'pg_query',
    description: 'Execute uma query SQL no PostgreSQL (read-only). Use para analisar dados, performance, e estrutura.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query SQL (SELECT, EXPLAIN, etc.)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'pg_explain',
    description: 'Executa EXPLAIN ANALYZE em uma query para análise de performance.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Query SQL para analisar' },
        analyze: { type: 'boolean', description: 'Usar EXPLAIN ANALYZE (default: true)' },
        buffers: { type: 'boolean', description: 'Incluir buffer usage (default: false)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'pg_slow_queries',
    description: 'Lista as queries mais lentas em execução no momento.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'integer', description: 'Número máximo (default: 10)' },
        minDuration: { type: 'integer', description: 'Duração mínima em ms (default: 100)' },
      },
    },
  },
  {
    name: 'pg_tables',
    description: 'Lista tabelas com tamanhos, row counts e índices.',
    inputSchema: {
      type: 'object',
      properties: {
        schema: { type: 'string', description: 'Schema (default: public)' },
      },
    },
  },
  {
    name: 'pg_indexes',
    description: 'Lista índices com estatísticas de uso (scans, tamanho).',
    inputSchema: {
      type: 'object',
      properties: {
        table: { type: 'string', description: 'Filtrar por tabela específica' },
      },
    },
  },
  {
    name: 'pg_locks',
    description: 'Mostra locks ativos no banco — útil para detectar deadlocks e contenção.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'pg_connections',
    description: 'Mostra conexões ativas com detalhes (query atual, duração, estado).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'pg_vacuum',
    description: 'Mostra estatísticas de vacuum/autovacuum das tabelas.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

function maskPassword(connString: string): string {
  return connString.replace(/password=([^ ]+)/, 'password=***');
}

const server = new Server(
  { name: 'postgresql-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const client = getClient();

  try {
    await client.connect();

    switch (name) {
      case 'pg_query': {
        const query = String(args?.query);
        if (!/^(SELECT|EXPLAIN|SHOW|WITH)\b/i.test(query.trim())) {
          return { content: [{ type: 'text', text: 'Apenas queries read-only (SELECT, EXPLAIN, SHOW, WITH) são permitidas.' }], isError: true };
        }
        const result = await client.query(query);
        return { content: [{ type: 'text', text: JSON.stringify({ rows: result.rows.slice(0, 100), rowCount: result.rowCount }, null, 2) }] };
      }
      case 'pg_explain': {
        const prefix = args?.analyze !== false ? 'EXPLAIN ANALYZE' : 'EXPLAIN';
        const buffers = args?.buffers ? ' (BUFFERS)' : '';
        const result = await client.query(`${prefix}${buffers} ${args?.query}`);
        return { content: [{ type: 'text', text: result.rows.map((r: any) => r['QUERY PLAN']).join('\n') }] };
      }
      case 'pg_slow_queries': {
        const result = await client.query(`
          SELECT pid, now() - pg_stat_activity.query_start AS duration,
                 state, LEFT(query, 200) AS query
          FROM pg_stat_activity
          WHERE state != 'idle' AND query NOT LIKE '%pg_stat_activity%'
          ORDER BY duration DESC LIMIT $1
        `, [args?.limit || 10]);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
      }
      case 'pg_tables': {
        const result = await client.query(`
          SELECT schemaname, tablename,
                 pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS total_size,
                 n_live_tup AS rows,
                 n_dead_tup AS dead_rows,
                 last_vacuum, last_autovacuum
          FROM pg_stat_user_tables
          WHERE schemaname = $1
          ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
        `, [args?.schema || 'public']);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
      }
      case 'pg_indexes': {
        let query = `
          SELECT tablename, indexname, indexdef,
                 idx_scan, idx_tup_read, idx_tup_fetch,
                 pg_size_pretty(pg_relation_size(indexname::regclass)) AS size
          FROM pg_stat_user_indexes
          JOIN pg_indexes ON pg_stat_user_indexes.indexrelname = pg_indexes.indexname
          WHERE 1=1
        `;
        const params: string[] = [];
        if (args?.table) { query += ' AND tablename = $1'; params.push(String(args.table)); }
        query += ' ORDER BY idx_scan DESC LIMIT 30';
        const result = await client.query(query, params);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
      }
      case 'pg_locks': {
        const result = await client.query(`
          SELECT l.pid, l.locktype, l.mode, l.granted,
                 a.query AS blocked_query,
                 now() - a.query_start AS duration
          FROM pg_locks l
          JOIN pg_stat_activity a ON l.pid = a.pid
          WHERE NOT l.granted
          ORDER BY duration DESC
        `);
        return { content: [{ type: 'text', text: result.rows.length > 0 ? JSON.stringify(result.rows, null, 2) : 'Nenhum lock bloqueado no momento.' }] };
      }
      case 'pg_connections': {
        const result = await client.query(`
          SELECT pid, usename, application_name, client_addr,
                 state, now() - query_start AS duration,
                 LEFT(query, 150) AS query
          FROM pg_stat_activity
          ORDER BY duration DESC
        `);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
      }
      case 'pg_vacuum': {
        const result = await client.query(`
          SELECT schemaname, relname,
                 last_vacuum, last_autovacuum,
                 vacuum_count, autovacuum_count,
                 n_dead_tup, n_live_tup,
                 ROUND(100.0 * n_dead_tup / NULLIF(n_live_tup + n_dead_tup, 0), 1) AS dead_ratio
          FROM pg_stat_user_tables
          ORDER BY n_dead_tup DESC LIMIT 20
        `);
        return { content: [{ type: 'text', text: JSON.stringify(result.rows, null, 2) }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `PostgreSQL error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  } finally {
    await client.end().catch(() => {});
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
