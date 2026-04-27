
import { TracingService } from './src/observability/tracing.js';

async function test() {
  const tracing = new TracingService({ inMemoryExporter: true });
  const span = tracing.startLLMSpan('test', 'model');
  tracing.recordLLMUsage(span, { promptTokens: 10, completionTokens: 10, totalTokens: 20 });
  
  const spans = tracing.getFinishedSpans();
  console.log('Spans count:', spans.length);
  try {
    const json = JSON.stringify(spans);
    console.log('JSON length:', json.length);
  } catch (err) {
    console.error('JSON.stringify failed:', err);
  }
}

test();
