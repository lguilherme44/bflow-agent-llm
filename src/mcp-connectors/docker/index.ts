/**
 * Docker MCP Connector — manage containers, images, volumes, and compose.
 *
 * Usage in mcp-servers.json:
 * { "docker": { "command": "node", "args": ["dist/mcp-connectors/docker/index.js"] } }
 *
 * Talks to Docker daemon via CLI (docker/docker-compose commands).
 * Uses the existing sandbox infrastructure for execution.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';
import { execSync } from 'node:child_process';

function docker(args: string): { stdout: string; stderr: string; ok: boolean } {
  try {
    const stdout = execSync(`docker ${args}`, { stdio: 'pipe', timeout: 30000, encoding: 'utf-8' });
    return { stdout, stderr: '', ok: true };
  } catch (e: any) {
    return { stdout: e.stdout || '', stderr: e.stderr || e.message, ok: false };
  }
}

function compose(dir: string, args: string): { stdout: string; stderr: string; ok: boolean } {
  try {
    const stdout = execSync(`docker compose ${args}`, { cwd: dir, stdio: 'pipe', timeout: 60000, encoding: 'utf-8' });
    return { stdout, stderr: '', ok: true };
  } catch (e: any) {
    return { stdout: e.stdout || '', stderr: e.stderr || e.message, ok: false };
  }
}

const TOOLS: Tool[] = [
  {
    name: 'docker_ps',
    description: 'Lista containers em execução (ou todos com --all).',
    inputSchema: {
      type: 'object',
      properties: {
        all: { type: 'boolean', description: 'Mostrar containers parados também' },
        format: { type: 'string', description: 'Formato (json, table). Default: json' },
      },
    },
  },
  {
    name: 'docker_logs',
    description: 'Busca logs de um container específico.',
    inputSchema: {
      type: 'object',
      properties: {
        container: { type: 'string', description: 'Nome ou ID do container' },
        tail: { type: 'integer', description: 'Últimas N linhas (default: 100)' },
        since: { type: 'string', description: 'Desde quando (ex: 10m, 1h)' },
      },
      required: ['container'],
    },
  },
  {
    name: 'docker_stats',
    description: 'Mostra estatísticas de uso de recursos (CPU, RAM, rede) dos containers.',
    inputSchema: {
      type: 'object',
      properties: {
        container: { type: 'string', description: 'Filtrar por container específico' },
      },
    },
  },
  {
    name: 'docker_images',
    description: 'Lista imagens Docker locais com tamanho e tag.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'docker_inspect',
    description: 'Inspeciona um container ou imagem com detalhes completos (env, ports, volumes, network).',
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'Nome ou ID do container/imagem' },
      },
      required: ['target'],
    },
  },
  {
    name: 'docker_compose_ps',
    description: 'Lista serviços do docker-compose no diretório atual.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Diretório do docker-compose.yml (default: cwd)' },
      },
    },
  },
  {
    name: 'docker_compose_logs',
    description: 'Busca logs dos serviços do docker-compose.',
    inputSchema: {
      type: 'object',
      properties: {
        directory: { type: 'string', description: 'Diretório do docker-compose.yml' },
        service: { type: 'string', description: 'Nome do serviço (opcional)' },
        tail: { type: 'integer', description: 'Últimas N linhas (default: 100)' },
      },
      required: ['directory'],
    },
  },
  {
    name: 'docker_prune',
    description: 'Mostra o que seria removido com docker system prune (sem executar). Use --execute=true para limpar.',
    inputSchema: {
      type: 'object',
      properties: {
        execute: { type: 'boolean', description: 'Executar a limpeza? (default: false — apenas simula)' },
      },
    },
  },
];

const server = new Server(
  { name: 'docker-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'docker_ps': {
        const formatArg = args?.format !== 'table' ? '--format json' : '';
        const allArg = args?.all ? '--all' : '';
        const result = docker(`ps ${allArg} ${formatArg}`);
        if (!result.ok) return { content: [{ type: 'text', text: `Docker error: ${result.stderr}` }], isError: true };
        const lines = result.stdout.trim().split('\n').filter(Boolean);
        const containers = lines.map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
        return { content: [{ type: 'text', text: JSON.stringify({ count: containers.length, containers }, null, 2) }] };
      }
      case 'docker_logs': {
        const tail = args?.tail || 100;
        const since = args?.since ? `--since ${args.since}` : '';
        const result = docker(`logs --tail ${tail} ${since} ${args?.container}`);
        return { content: [{ type: 'text', text: result.ok ? result.stdout.slice(-5000) : `Error: ${result.stderr}` }] };
      }
      case 'docker_stats': {
        const containerFilter = args?.container ? args.container as string : '';
        const result = docker(`stats --no-stream --format "{{json .}}" ${containerFilter}`);
        if (!result.ok) return { content: [{ type: 'text', text: `Docker error: ${result.stderr}` }], isError: true };
        const stats = result.stdout.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
        return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
      }
      case 'docker_images': {
        const result = docker('images --format "{{json .}}"');
        if (!result.ok) return { content: [{ type: 'text', text: `Docker error: ${result.stderr}` }], isError: true };
        const images = result.stdout.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
        return { content: [{ type: 'text', text: JSON.stringify({ count: images.length, images: images.slice(0, 30) }, null, 2) }] };
      }
      case 'docker_inspect': {
        const result = docker(`inspect ${args?.target}`);
        if (!result.ok) return { content: [{ type: 'text', text: `Docker error: ${result.stderr}` }], isError: true };
        const data = JSON.parse(result.stdout);
        return { content: [{ type: 'text', text: JSON.stringify(data.map((d: any) => ({
          id: d.Id?.slice(0, 12),
          name: d.Name?.replace(/^\//, ''),
          state: d.State?.Status,
          image: d.Config?.Image,
          ports: d.NetworkSettings?.Ports ? Object.keys(d.NetworkSettings.Ports) : [],
          env: (d.Config?.Env || []).filter((e: string) => !/(PASSWORD|SECRET|KEY|TOKEN)/i.test(e)),
          mounts: (d.Mounts || []).map((m: any) => ({ src: m.Source, dest: m.Destination })),
          network: d.HostConfig?.NetworkMode,
          memory: d.HostConfig?.Memory ? `${(d.HostConfig.Memory / 1024 / 1024).toFixed(0)}MB` : 'unlimited',
        })), null, 2) }] };
      }
      case 'docker_compose_ps': {
        const dir = String(args?.directory || process.cwd());
        const result = compose(dir, 'ps --format "{{json .}}"');
        if (!result.ok) return { content: [{ type: 'text', text: `Compose error: ${result.stderr}` }], isError: true };
        const services = result.stdout.trim().split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return { raw: l }; } });
        return { content: [{ type: 'text', text: JSON.stringify({ directory: dir, services }, null, 2) }] };
      }
      case 'docker_compose_logs': {
        const dir = String(args?.directory || process.cwd());
        const service = args?.service ? ` ${args.service}` : '';
        const tail = args?.tail || 100;
        const result = compose(dir, `logs --tail ${tail}${service}`);
        return { content: [{ type: 'text', text: result.stdout.slice(-5000) || result.stderr }] };
      }
      case 'docker_prune': {
        if (args?.execute) {
          const result = docker('system prune -f');
          return { content: [{ type: 'text', text: result.ok ? `✅ Cleanup complete:\n${result.stdout}` : `Error: ${result.stderr}` }] };
        }
        const result = docker('system df');
        return { content: [{ type: 'text', text: result.ok ? `📊 Docker disk usage (dry run):\n${result.stdout}\n\nUse execute=true para limpar.` : `Error: ${result.stderr}` }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    return { content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
