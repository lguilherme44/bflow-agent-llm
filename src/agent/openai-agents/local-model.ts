import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';

/**
 * Modelo adaptado para modelos locais que não suportam tool_calls nativo.
 * 
 * Modelos como Qwen2.5-Coder e DeepSeek no Ollama/LM Studio frequentemente
 * retornam a chamada de ferramenta dentro do `content` como JSON em vez de
 * usar o campo `tool_calls` da API. Este wrapper intercepta a resposta e
 * converte automaticamente o JSON do content em tool_calls.
 * 
 * Fluxo:
 * 1. Envia request normalmente com tools via Chat Completions API
 * 2. Se a resposta tiver tool_calls, retorna normalmente
 * 3. Se não, tenta extrair JSON de tool call do content
 * 4. Se encontrar, converte para tool_calls e re-envia como se fosse nativo
 */
export class LocalToolCallingModel {
  private client: OpenAI;
  private model: string;
  private toolSchemas: Map<string, any> = new Map();

  constructor(client: OpenAI, model: string) {
    this.client = client;
    this.model = model;
  }

  /**
   * Implementa a interface Model do @openai/agents
   */
  getRetryAdvice() {
    return undefined;
  }

  async getResponse(request: any): Promise<any> {
    // Construir mensagens no formato OpenAI
    const messages = this.buildMessages(request);
    const tools = this.buildTools(request);

    // Salvar schemas para validação
    if (tools) {
      for (const t of tools) {
        const fn = (t as any).function;
        if (fn) {
          this.toolSchemas.set(fn.name, fn.parameters);
        }
      }
    }

    // Debug: ver o que está sendo enviado
    const debug = process.env.AGENT_DEBUG === '1';
    if (debug) {
      console.error(`[LocalModel] === REQUEST ===`);
      console.error(`[LocalModel] input type: ${typeof request.input}, isArray: ${Array.isArray(request.input)}`);
      if (Array.isArray(request.input)) {
        for (const item of request.input) {
          console.error(`[LocalModel]   item.type=${item.type} item.role=${item.role || '-'} callId=${item.callId || '-'} name=${item.name || '-'}`);
          if (item.output) console.error(`[LocalModel]     output: ${JSON.stringify(item.output).slice(0, 200)}`);
        }
      }
      console.error(`[LocalModel] Msgs construídas: ${messages.length}, Tools: ${tools?.length ?? 0}`);
      for (const m of messages) {
        console.error(`[LocalModel]   msg role=${m.role} content=${JSON.stringify((m as any).content).slice(0, 150)}`);
      }
    }

    const completion = await this.client.chat.completions.create({
      model: this.model,
      messages,
      tools: tools && tools.length > 0 ? tools : undefined,
      temperature: request.modelSettings?.temperature ?? 0.1,
      max_tokens: request.modelSettings?.maxTokens ?? 2048,
    });

    const choice = completion.choices[0];
    if (!choice) {
      if (debug) console.error('[LocalModel] Sem choices na resposta');
      return this.createEmptyResponse(completion);
    }

    if (debug) {
      console.error(`[LocalModel] finish_reason: ${choice.finish_reason}`);
      console.error(`[LocalModel] content: ${JSON.stringify(choice.message.content).slice(0, 300)}`);
      console.error(`[LocalModel] tool_calls: ${JSON.stringify(choice.message.tool_calls)}`);
    }

    // Se já tem tool_calls nativas, converter para formato do SDK
    if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
      if (debug) console.error('[LocalModel] → Usando tool_calls nativas');

      // Interceptar complete_task para parar o loop
      const completeTaskCall = choice.message.tool_calls.find((tc: any) => tc.function?.name === 'complete_task');
      if (completeTaskCall) {
        if (debug) console.error('[LocalModel] → Interceptando complete_task nativo, retornando como texto final.');
        let finalMessage = 'Tarefa concluída.';
        try {
          const args = JSON.parse((completeTaskCall as any).function.arguments || '{}');
          const values = Object.values(args);
          if (values.length > 0) {
            finalMessage = values.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join('\n');
          }
        } catch {}
        return this.convertTextResponse(finalMessage, completion);
      }

      return this.convertNativeToolCalls(choice, completion);
    }

    // Tentar extrair tool call do content
    const content = choice.message.content || '';
    const extractedCall = this.extractToolCallFromContent(content);

    if (extractedCall && this.toolSchemas.has(extractedCall.name)) {
      if (debug) console.error(`[LocalModel] → Extraiu tool call do content: ${extractedCall.name}(${JSON.stringify(extractedCall.arguments)})`);

      // Interceptar complete_task para parar o loop
      if (extractedCall.name === 'complete_task') {
        if (debug) console.error('[LocalModel] → Interceptando complete_task extraído, retornando como texto final.');
        let finalMessage = 'Tarefa concluída.';
        if (extractedCall.arguments) {
          if (typeof extractedCall.arguments === 'object') {
            const values = Object.values(extractedCall.arguments);
            if (values.length > 0) {
              finalMessage = values.map(v => typeof v === 'object' ? JSON.stringify(v) : String(v)).join('\n');
            }
          } else {
            finalMessage = String(extractedCall.arguments);
          }
        }
        return this.convertTextResponse(finalMessage, completion);
      }

      return this.convertExtractedToolCall(extractedCall, completion);
    }

    // Resposta de texto normal
    if (debug) console.error(`[LocalModel] → Texto normal: ${content.slice(0, 100)}`);
    return this.convertTextResponse(content, completion);
  }

  async *getStreamedResponse(request: any): AsyncIterable<any> {
    // Para modelos locais, streaming não é crítico — usar non-streaming
    const response = await this.getResponse(request);
    yield response;
  }

  // ── Conversão de formatos ─────────────────────────────────────

  private convertNativeToolCalls(choice: any, completion: any) {
    const output: any[] = [];

    // Adicionar texto do assistente se houver
    if (choice.message.content) {
      const cleaned = this.cleanSpecialTokens(choice.message.content);
      if (cleaned) {
        output.push({
          id: randomUUID(),
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: cleaned, annotations: [] }],
          status: 'completed',
        });
      }
    }

    // Converter tool_calls
    for (const tc of choice.message.tool_calls) {
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(tc.function.arguments || '{}');
      } catch {
        args = {};
      }

      output.push({
        id: tc.id || randomUUID(),
        type: 'function_call',
        callId: tc.id || randomUUID(),
        name: tc.function.name,
        arguments: JSON.stringify(args),
        status: 'completed',
      });
    }

    return {
      output,
      usage: this.extractUsage(completion),
      responseId: completion.id,
    };
  }

  private convertExtractedToolCall(extracted: { name: string; arguments: Record<string, any> }, completion: any) {
    const callId = randomUUID();
    return {
      output: [
        {
          id: callId,
          type: 'function_call',
          callId,
          name: extracted.name,
          arguments: JSON.stringify(extracted.arguments),
          status: 'completed',
        },
      ],
      usage: this.extractUsage(completion),
      responseId: completion.id,
    };
  }

  private convertTextResponse(content: string, completion: any) {
    const cleaned = this.cleanSpecialTokens(content);
    return {
      output: [
        {
          id: randomUUID(),
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: cleaned || 'Sem resposta.', annotations: [] }],
          status: 'completed',
        },
      ],
      usage: this.extractUsage(completion),
      responseId: completion.id,
    };
  }

  private createEmptyResponse(completion: any) {
    return {
      output: [
        {
          id: randomUUID(),
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: 'Sem resposta do modelo.', annotations: [] }],
          status: 'completed',
        },
      ],
      usage: this.extractUsage(completion),
      responseId: completion.id,
    };
  }

  // ── Extração de tool calls do content ─────────────────────────

  /**
   * Tenta extrair uma chamada de ferramenta do content textual.
   * 
   * Suporta formatos comuns de modelos locais:
   * - {"name": "tool_name", "arguments": {...}}
   * - {"name": "tool_name", "parameters": {...}}
   * - {"tool": "tool_name", "arguments": {...}}
   * - <tool_call>{"name": "tool_name", ...}</tool_call>
   * - </think>\n{"name": "tool_name", ...}  (DeepSeek R1)
   */
  private extractToolCallFromContent(content: string): { name: string; arguments: Record<string, any> } | null {
    if (!content || content.trim().length === 0) return null;

    // Limpar tags especiais
    let cleaned = content
      .replace(/<\|[a-z_]+\|>/gi, '')           // <|im_start|> etc
      .replace(/<\/?(think|tool_call)>/gi, '')   // <think>, </think>, <tool_call>
      .trim();

    // Tentar encontrar o JSON
    const jsonStr = this.extractJson(cleaned);
    if (!jsonStr) return null;

    try {
      const parsed = JSON.parse(jsonStr);

      // Formato: {"name": "tool", "arguments": {...}}
      if (typeof parsed.name === 'string' && this.toolSchemas.has(parsed.name)) {
        return {
          name: parsed.name,
          arguments: parsed.arguments || parsed.parameters || {},
        };
      }

      // Formato: {"tool": "tool_name", "arguments": {...}}
      if (typeof parsed.tool === 'string' && this.toolSchemas.has(parsed.tool)) {
        return {
          name: parsed.tool,
          arguments: parsed.arguments || parsed.parameters || {},
        };
      }

      // Formato: {"tool_name": {"arg": "value"}} — menos comum
      for (const key of Object.keys(parsed)) {
        if (this.toolSchemas.has(key) && typeof parsed[key] === 'object') {
          return { name: key, arguments: parsed[key] };
        }
      }
    } catch {
      // JSON inválido — ignorar
    }

    return null;
  }

  private extractJson(text: string): string | null {
    // Bloco de código
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced?.[1]?.trim()) return fenced[1].trim();

    // JSON direto
    const trimmed = text.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;

    // JSON embutido no texto
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return text.slice(start, end + 1);
    }

    return null;
  }

  // ── Helpers ───────────────────────────────────────────────────

  private cleanSpecialTokens(text: string): string {
    return text
      .replace(/<\|[a-z_]+\|>/gi, '')
      .replace(/<\/?(think|tool_call)>/gi, '')
      .replace(/```json\s*```/g, '')
      .replace(/```\s*```/g, '')
      .trim();
  }

  private extractUsage(completion: any) {
    const u = completion.usage;
    return {
      requests: 1,
      inputTokens: u?.prompt_tokens ?? 0,
      outputTokens: u?.completion_tokens ?? 0,
      totalTokens: u?.total_tokens ?? 0,
    };
  }

  private buildMessages(request: any): OpenAI.ChatCompletionMessageParam[] {
    const messages: OpenAI.ChatCompletionMessageParam[] = [];

    // System prompt
    if (request.systemInstructions) {
      messages.push({ role: 'system', content: request.systemInstructions });
    }

    // Converter input do SDK para mensagens
    if (request.input) {
      if (typeof request.input === 'string') {
        messages.push({ role: 'user', content: request.input });
      } else if (Array.isArray(request.input)) {
        for (const item of request.input) {
          if (item.type === 'message' && item.role) {
            let textContent = '';
            if (typeof item.content === 'string') {
              textContent = item.content;
            } else if (Array.isArray(item.content)) {
              textContent = item.content
                .filter((c: any) => c.type === 'input_text' || c.type === 'output_text' || c.type === 'text')
                .map((c: any) => c.text || c.value || '')
                .join('\n');
            }
            if (textContent) {
              messages.push({
                role: item.role === 'user' ? 'user' : 'assistant',
                content: textContent,
              });
            }
          } else if (item.type === 'function_call') {
            messages.push({
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: item.callId || item.id,
                type: 'function' as const,
                function: { name: item.name, arguments: item.arguments || '{}' },
              }],
            });
          } else if (item.type === 'function_call_output' || item.type === 'function_call_result') {
            // Extrair o texto do output (pode ser string, objeto, ou {type:'text', text:'...'})
            let outputText = '';
            if (typeof item.output === 'string') {
              outputText = item.output;
            } else if (item.output && typeof item.output === 'object') {
              if (item.output.type === 'text' && item.output.text) {
                outputText = item.output.text;
              } else {
                outputText = JSON.stringify(item.output);
              }
            }
            // Truncar output para evitar estouro de contexto em modelos locais
            const MAX_TOOL_OUTPUT = 3000;
            if (outputText.length > MAX_TOOL_OUTPUT) {
              outputText = outputText.slice(0, MAX_TOOL_OUTPUT) + '\n\n[... truncado. Use ranges de linha ou filtros para ver mais.]';
            }
            messages.push({
              role: 'tool',
              tool_call_id: item.callId || item.id,
              content: outputText || '{}',
            });
          }
        }
      }
    }

    return messages;
  }

  private buildTools(request: any): OpenAI.ChatCompletionTool[] | undefined {
    if (!request.tools || request.tools.length === 0) return undefined;

    return request.tools
      .filter((t: any) => t.type === 'function')
      .map((t: any) => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description || '',
          parameters: t.parameters || { type: 'object', properties: {} },
        },
      }));
  }
}
