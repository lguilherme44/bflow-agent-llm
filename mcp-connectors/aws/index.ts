/**
 * AWS MCP Connector — manage S3, EC2, RDS, Lambda, CloudWatch.
 *
 * Usage in mcp-servers.json:
 * { "aws": { "command": "node", "args": ["dist/mcp-connectors/aws/index.js"],
 *   "env": { "AWS_REGION": "us-east-1", "AWS_ACCESS_KEY_ID": "...", "AWS_SECRET_ACCESS_KEY": "..." } } }
 *
 * Requires: @aws-sdk/client-s3, @aws-sdk/client-ec2, @aws-sdk/client-rds,
 *           @aws-sdk/client-lambda, @aws-sdk/client-cloudwatch-logs
 * Install: npm install @aws-sdk/client-s3 @aws-sdk/client-ec2 @aws-sdk/client-rds @aws-sdk/client-lambda @aws-sdk/client-cloudwatch-logs
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';

// Lazy-load AWS SDKs to avoid requiring them at import time
async function getS3Client() {
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({ region: process.env.AWS_REGION || 'us-east-1' });
}
async function getEC2Client() {
  const { EC2Client } = await import('@aws-sdk/client-ec2');
  return new EC2Client({ region: process.env.AWS_REGION || 'us-east-1' });
}
async function getRDSClient() {
  const { RDSClient } = await import('@aws-sdk/client-rds');
  return new RDSClient({ region: process.env.AWS_REGION || 'us-east-1' });
}
async function getLambdaClient() {
  const { LambdaClient } = await import('@aws-sdk/client-lambda');
  return new LambdaClient({ region: process.env.AWS_REGION || 'us-east-1' });
}
async function getCloudWatchLogsClient() {
  const { CloudWatchLogsClient } = await import('@aws-sdk/client-cloudwatch-logs');
  return new CloudWatchLogsClient({ region: process.env.AWS_REGION || 'us-east-1' });
}

const TOOLS: Tool[] = [
  {
    name: 'aws_s3_list',
    description: 'Lista buckets S3 ou objetos dentro de um bucket.',
    inputSchema: {
      type: 'object',
      properties: {
        bucket: { type: 'string', description: 'Nome do bucket (opcional — lista todos se omitido)' },
        prefix: { type: 'string', description: 'Prefixo para filtrar objetos' },
        maxKeys: { type: 'integer', description: 'Máximo de objetos (default: 50)' },
      },
    },
  },
  {
    name: 'aws_ec2_list',
    description: 'Lista instâncias EC2 com status, tipo, IP e tags.',
    inputSchema: {
      type: 'object',
      properties: {
        state: { type: 'string', enum: ['running', 'stopped', 'terminated'], description: 'Filtrar por estado' },
      },
    },
  },
  {
    name: 'aws_rds_list',
    description: 'Lista instâncias RDS com endpoint, status, engine, storage.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'aws_lambda_list',
    description: 'Lista funções Lambda com runtime, memory, last modified.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'aws_cloudwatch_logs',
    description: 'Busca logs no CloudWatch Logs por grupo e filtro.',
    inputSchema: {
      type: 'object',
      properties: {
        logGroup: { type: 'string', description: 'Nome do log group' },
        filter: { type: 'string', description: 'Padrão de busca (ex: ERROR, timeout)' },
        limit: { type: 'integer', description: 'Máximo de eventos (default: 50)' },
        hours: { type: 'integer', description: 'Últimas N horas (default: 1)' },
      },
      required: ['logGroup'],
    },
  },
  {
    name: 'aws_cloudwatch_metrics',
    description: 'Lista métricas disponíveis no CloudWatch com namespace e dimensões.',
    inputSchema: {
      type: 'object',
      properties: {
        namespace: { type: 'string', description: 'Namespace (ex: AWS/RDS, AWS/Lambda, AWS/EC2)' },
        metricName: { type: 'string', description: 'Nome da métrica' },
      },
    },
  },
];

const server = new Server(
  { name: 'aws-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case 'aws_s3_list': {
        const s3 = await getS3Client();
        if (args?.bucket) {
          const { ListObjectsV2Command } = await import('@aws-sdk/client-s3');
          const result = await s3.send(new ListObjectsV2Command({
            Bucket: String(args.bucket),
            Prefix: args?.prefix ? String(args.prefix) : undefined,
            MaxKeys: args?.maxKeys || 50,
          }));
          return { content: [{ type: 'text', text: JSON.stringify({
            bucket: args.bucket,
            count: result.Contents?.length || 0,
            objects: result.Contents?.slice(0, 50).map(o => ({
              key: o.Key, size: o.Size, modified: o.LastModified?.toISOString(),
            })),
          }, null, 2) }] };
        }
        const { ListBucketsCommand } = await import('@aws-sdk/client-s3');
        const result = await s3.send(new ListBucketsCommand({}));
        return { content: [{ type: 'text', text: JSON.stringify({
          buckets: result.Buckets?.map(b => ({ name: b.Name, created: b.CreationDate?.toISOString() })),
        }, null, 2) }] };
      }
      case 'aws_ec2_list': {
        const ec2 = await getEC2Client();
        const { DescribeInstancesCommand } = await import('@aws-sdk/client-ec2');
        const filters = args?.state ? [{ Name: 'instance-state-name', Values: [String(args.state)] }] : [];
        const result = await ec2.send(new DescribeInstancesCommand({ Filters: filters }));
        const instances = result.Reservations?.flatMap(r => r.Instances || []) || [];
        return { content: [{ type: 'text', text: JSON.stringify({
          count: instances.length,
          instances: instances.slice(0, 20).map(i => ({
            id: i.InstanceId, type: i.InstanceType, state: i.State?.Name,
            ip: i.PrivateIpAddress, publicIp: i.PublicIpAddress,
            launchTime: i.LaunchTime?.toISOString(),
            tags: Object.fromEntries((i.Tags || []).map(t => [t.Key, t.Value])),
          })),
        }, null, 2) }] };
      }
      case 'aws_rds_list': {
        const rds = await getRDSClient();
        const { DescribeDBInstancesCommand } = await import('@aws-sdk/client-rds');
        const result = await rds.send(new DescribeDBInstancesCommand({}));
        return { content: [{ type: 'text', text: JSON.stringify({
          count: result.DBInstances?.length || 0,
          instances: result.DBInstances?.slice(0, 20).map(i => ({
            id: i.DBInstanceIdentifier, engine: i.Engine, version: i.EngineVersion,
            class: i.DBInstanceClass, status: i.DBInstanceStatus,
            endpoint: i.Endpoint?.Address, port: i.Endpoint?.Port,
            storage: i.AllocatedStorage, multiAz: i.MultiAZ,
          })),
        }, null, 2) }] };
      }
      case 'aws_lambda_list': {
        const lambda = await getLambdaClient();
        const { ListFunctionsCommand } = await import('@aws-sdk/client-lambda');
        const result = await lambda.send(new ListFunctionsCommand({ MaxItems: 50 }));
        return { content: [{ type: 'text', text: JSON.stringify({
          count: result.Functions?.length || 0,
          functions: result.Functions?.slice(0, 30).map(f => ({
            name: f.FunctionName, runtime: f.Runtime,
            memory: f.MemorySize, timeout: f.Timeout,
            lastModified: f.LastModified,
            description: f.Description?.slice(0, 100),
          })),
        }, null, 2) }] };
      }
      case 'aws_cloudwatch_logs': {
        const cw = await getCloudWatchLogsClient();
        const { FilterLogEventsCommand } = await import('@aws-sdk/client-cloudwatch-logs');
        const hours = (args?.hours || 1) as number;
        const startTime = Date.now() - hours * 3600 * 1000;
        const result = await cw.send(new FilterLogEventsCommand({
          logGroupName: String(args?.logGroup),
          filterPattern: args?.filter ? String(args.filter) : undefined,
          limit: args?.limit || 50,
          startTime,
        }));
        return { content: [{ type: 'text', text: JSON.stringify({
          count: result.events?.length || 0,
          events: result.events?.slice(0, 30).map(e => ({
            timestamp: e.timestamp ? new Date(e.timestamp).toISOString() : null,
            message: e.message?.slice(0, 300),
          })),
        }, null, 2) }] };
      }
      case 'aws_cloudwatch_metrics': {
        const cw = await getCloudWatchLogsClient();
        return { content: [{ type: 'text', text: JSON.stringify({
          namespace: args?.namespace || 'all',
          metricName: args?.metricName || 'all',
          note: 'CloudWatch metrics listing é limitado via SDK. Use o console AWS para exploração completa.',
        }, null, 2) }] };
      }
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('CredentialsProviderError') || msg.includes('Could not load credentials')) {
      return { content: [{ type: 'text', text: 'AWS credentials not configured. Set AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY env vars, or configure ~/.aws/credentials.' }], isError: true };
    }
    return { content: [{ type: 'text', text: `AWS error: ${msg}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
