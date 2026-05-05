/**
 * AWS MCP Connector — S3, EC2, RDS, Lambda, CloudWatch.
 * Requires: npm install @aws-sdk/client-s3 @aws-sdk/client-ec2 @aws-sdk/client-rds @aws-sdk/client-lambda @aws-sdk/client-cloudwatch-logs
 * Falls back gracefully if SDK not installed.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema, Tool } from '@modelcontextprotocol/sdk/types.js';

function getSDK(name: string): any {
  try { return require(name); } catch { return null; }
}

const TOOLS: Tool[] = [
  { name: 'aws_s3_list', description: 'Lista buckets S3 ou objetos.', inputSchema: { type: 'object', properties: { bucket: { type: 'string' }, prefix: { type: 'string' }, maxKeys: { type: 'integer' } } } },
  { name: 'aws_ec2_list', description: 'Lista instâncias EC2.', inputSchema: { type: 'object', properties: { state: { type: 'string', enum: ['running', 'stopped', 'terminated'] } } } },
  { name: 'aws_rds_list', description: 'Lista instâncias RDS.', inputSchema: { type: 'object', properties: {} } },
  { name: 'aws_lambda_list', description: 'Lista funções Lambda.', inputSchema: { type: 'object', properties: {} } },
  { name: 'aws_cloudwatch_logs', description: 'Busca logs no CloudWatch.', inputSchema: { type: 'object', properties: { logGroup: { type: 'string' }, filter: { type: 'string' }, limit: { type: 'integer' }, hours: { type: 'integer' } }, required: ['logGroup'] } },
  { name: 'aws_cloudwatch_metrics', description: 'Lista métricas CloudWatch.', inputSchema: { type: 'object', properties: { namespace: { type: 'string' }, metricName: { type: 'string' } } } },
];

function checkSDK(): { ok: boolean; error?: string } {
  const needed = ['@aws-sdk/client-s3', '@aws-sdk/client-ec2', '@aws-sdk/client-rds', '@aws-sdk/client-lambda', '@aws-sdk/client-cloudwatch-logs'];
  const missing = needed.filter(n => !getSDK(n));
  if (missing.length > 0) return { ok: false, error: `Missing AWS SDK packages: ${missing.join(', ')}. Run: npm install ${missing.join(' ')}` };
  return { ok: true };
}

const server = new Server({ name: 'aws-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const sdk = checkSDK();
  if (!sdk.ok) return { content: [{ type: 'text', text: sdk.error! }], isError: true };

  const region = process.env.AWS_REGION || 'us-east-1';

  try {
    switch (name) {
      case 'aws_s3_list': {
        const { S3Client, ListObjectsV2Command, ListBucketsCommand } = getSDK('@aws-sdk/client-s3');
        const s3 = new S3Client({ region });
        if (args?.bucket) {
          const r = await s3.send(new ListObjectsV2Command({ Bucket: String(args.bucket), Prefix: args?.prefix ? String(args.prefix) : undefined, MaxKeys: args?.maxKeys || 50 }));
          return { content: [{ type: 'text', text: JSON.stringify({ bucket: args.bucket, count: r.Contents?.length || 0, objects: r.Contents?.slice(0, 50).map((o: any) => ({ key: o.Key, size: o.Size })) }, null, 2) }] };
        }
        const r = await s3.send(new ListBucketsCommand({}));
        return { content: [{ type: 'text', text: JSON.stringify({ buckets: r.Buckets?.map((b: any) => b.Name) }) }] };
      }
      case 'aws_ec2_list': {
        const { EC2Client, DescribeInstancesCommand } = getSDK('@aws-sdk/client-ec2');
        const ec2 = new EC2Client({ region });
        const filters = args?.state ? [{ Name: 'instance-state-name', Values: [String(args.state)] }] : [];
        const r = await ec2.send(new DescribeInstancesCommand({ Filters: filters }));
        const instances = (r.Reservations || []).flatMap((res: any) => res.Instances || []);
        return { content: [{ type: 'text', text: JSON.stringify({ count: instances.length, instances: instances.slice(0, 20).map((i: any) => ({ id: i.InstanceId, type: i.InstanceType, state: i.State?.Name, ip: i.PrivateIpAddress })) }, null, 2) }] };
      }
      case 'aws_rds_list': {
        const { RDSClient, DescribeDBInstancesCommand } = getSDK('@aws-sdk/client-rds');
        const rds = new RDSClient({ region });
        const r = await rds.send(new DescribeDBInstancesCommand({}));
        return { content: [{ type: 'text', text: JSON.stringify({ count: r.DBInstances?.length || 0, instances: r.DBInstances?.slice(0, 20).map((i: any) => ({ id: i.DBInstanceIdentifier, engine: i.Engine, status: i.DBInstanceStatus, endpoint: i.Endpoint?.Address })) }, null, 2) }] };
      }
      case 'aws_lambda_list': {
        const { LambdaClient, ListFunctionsCommand } = getSDK('@aws-sdk/client-lambda');
        const lambda = new LambdaClient({ region });
        const r = await lambda.send(new ListFunctionsCommand({ MaxItems: 50 }));
        return { content: [{ type: 'text', text: JSON.stringify({ count: r.Functions?.length || 0, functions: r.Functions?.slice(0, 30).map((f: any) => ({ name: f.FunctionName, runtime: f.Runtime, memory: f.MemorySize })) }, null, 2) }] };
      }
      case 'aws_cloudwatch_logs': {
        const { CloudWatchLogsClient, FilterLogEventsCommand } = getSDK('@aws-sdk/client-cloudwatch-logs');
        const cw = new CloudWatchLogsClient({ region });
        const hours: number = (args?.hours || 1) as number;
        const r = await cw.send(new FilterLogEventsCommand({ logGroupName: String(args?.logGroup), filterPattern: args?.filter ? String(args.filter) : undefined, limit: args?.limit || 50, startTime: Date.now() - hours * 3600 * 1000 }));
        return { content: [{ type: 'text', text: JSON.stringify({ count: r.events?.length || 0, events: r.events?.slice(0, 30).map((e: any) => ({ message: e.message?.slice(0, 300) })) }, null, 2) }] };
      }
      case 'aws_cloudwatch_metrics':
        return { content: [{ type: 'text', text: 'Use o console AWS para exploração completa de métricas.' }] };
      default:
        return { content: [{ type: 'text', text: `Unknown: ${name}` }], isError: true };
    }
  } catch (error: any) {
    return { content: [{ type: 'text', text: `AWS error: ${error.message}` }], isError: true };
  }
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
main().catch(console.error);
