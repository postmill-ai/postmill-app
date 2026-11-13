// UNVERIFIED vs live key: fixtures exercise the installed SDKs, never OpenAI HTTP.
import { describe, it, expect, vi } from 'vitest';
import { generateText, stepCountIs, tool, jsonSchema } from 'ai';
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages';
import { Agent } from '@mastra/core/agent';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { OpenAIAdapter } from '../ai.adapter';

const models = ['gpt-4.1-mini', 'gpt-4.1', 'gpt-6-luna', 'gpt-6.1-terra'];
const response = (output: any[]) => ({ id: 'resp_fixture', object: 'response', created_at: 1, status: 'completed', output,
  usage: { input_tokens: 12, output_tokens: 7, output_tokens_details: { reasoning_tokens: 3 } } });
const text = { type: 'message', id: 'msg_fixture', role: 'assistant', content: [{ type: 'output_text', text: 'Done', annotations: [] }] };
const chat = (message: any) => ({ id: 'chat_fixture', object: 'chat.completion', created: 1, model: 'fixture', choices: [{ index: 0, message, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 7, total_tokens: 19 } });
function fixture(handler: (body: any, responses: boolean, n: number) => any) {
  const requests: any[] = [];
  const adapter = new OpenAIAdapter();
  adapter.setSafeFetch(async (url, init) => {
    const body = JSON.parse(init!.body as string); const responses = String(url).endsWith('/responses');
    requests.push({ url: String(url), body });
    // Reproduce the reported endpoint restriction, including default reasoning.
    if (body.model.startsWith('gpt-6') && !responses && body.tools?.length && body.reasoning_effort !== 'none')
      return new Response(JSON.stringify({ error: { message: 'Function tools with reasoning_effort require /v1/responses', type: 'invalid_request_error', code: 'unsupported_parameter' } }), { status: 400, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(handler(body, responses, requests.length)), { headers: { 'content-type': 'application/json' } });
  });
  return { adapter, requests };
}
const prompt: any = [{ role: 'system', content: 'Be helpful' }, { role: 'user', content: [{ type: 'text', text: 'Hello' }] }];

describe('OpenAI real SDK wire contracts', () => {
  it.each(models)('%s: text, endpoint, supported parameters and usage', async modelId => {
    const { adapter, requests } = fixture((_b, r) => r ? response([text]) : chat({ role: 'assistant', content: 'Done' }));
    const result = await adapter.createLanguageModel({ apiKey: 'fixture' }, modelId).doGenerate({ prompt, temperature: .7, topP: .9, maxOutputTokens: 80, providerOptions: { openai: { reasoningEffort: 'high' } } });
    const { url, body } = requests[0];
    expect(url.endsWith(modelId.startsWith('gpt-6') ? '/responses' : '/chat/completions')).toBe(true);
    expect(body.model).toBe(modelId);
    expect(result.content).toContainEqual(expect.objectContaining({ type: 'text', text: 'Done' }));
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 7 });
    if (modelId.startsWith('gpt-6')) {
      expect(body.reasoning.effort).toBe('high'); expect(body.temperature).toBeUndefined(); expect(body.top_p).toBeUndefined();
      expect(body.max_output_tokens).toBe(80); expect(body.input[1].content[0].type).toBe('input_text');
      expect(result.usage.reasoningTokens).toBe(3);
    } else { expect(body.temperature).toBe(.7); expect(body.reasoning_effort).toBeUndefined(); }
  });

  it.each([...models.map(id => [id, true] as const), ...models.filter(id => id.startsWith('gpt-6')).map(id => [id, false] as const)])('%s store=%s: two tool rounds through AI SDK agent loop', async (modelId, store) => {
    const { adapter, requests } = fixture((_b, r, n) => {
      if (n === 3) return r ? response([text]) : chat({ role: 'assistant', content: 'Done' });
      return r ? response([{ type: 'reasoning', id: `rs_${n}`, summary: [{ type: 'summary_text', text: 'Checking' }], encrypted_content: 'fixture-encrypted' }, { type: 'function_call', id: `fc_${n}`, call_id: `call_${n}`, name: 'lookup', arguments: '{"value":"test"}' }])
        : chat({ role: 'assistant', content: null, tool_calls: [{ id: `call_${n}`, type: 'function', function: { name: 'lookup', arguments: '{"value":"test"}' } }] });
    });
    const execute = vi.fn(async () => 'tool-result');
    const result = await generateText({ model: adapter.createLanguageModel({ apiKey: 'fixture' }, modelId), prompt: 'Look up twice', providerOptions: { openai: { store, reasoningEffort: 'high' } }, tools: { lookup: tool({ inputSchema: jsonSchema({ type: 'object', properties: { value: { type: 'string' } }, required: ['value'], additionalProperties: false }), execute }) }, stopWhen: stepCountIs(3), maxRetries: 0 });
    expect(result.text).toBe('Done'); expect(execute).toHaveBeenCalledTimes(2); expect(requests).toHaveLength(3);
    for (const [i, req] of requests.entries()) {
      expect(req.body.model).toBe(modelId);
      if (i && modelId.startsWith('gpt-6')) { expect(req.body.input).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: `call_${i}`, output: 'tool-result' })); if (store) expect(req.body.input).toContainEqual({ type: 'item_reference', id: `rs_${i}` }); else { expect(req.body.input).toContainEqual(expect.objectContaining({ type: 'reasoning', encrypted_content: 'fixture-encrypted' })); expect(req.body.include).toContain('reasoning.encrypted_content'); } }
      else if (i) expect(req.body.messages).toContainEqual(expect.objectContaining({ role: 'tool', tool_call_id: `call_${i}`, content: 'tool-result' }));
    }
  });

  it.each([400, 401, 429, 500, 503])('preserves upstream HTTP %i without changing API/model', async status => {
    const adapter = new OpenAIAdapter(); const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'fixture rejection', type: 'fixture', code: 'fixture' } }), { status, headers: { 'content-type': 'application/json' } }));
    adapter.setSafeFetch(fetch);
    await expect(adapter.createLanguageModel({ apiKey: 'fixture' }, 'gpt-6-luna').doGenerate({ prompt })).rejects.toMatchObject({ statusCode: status });
    await expect(adapter.createLanguageModel({ apiKey: 'fixture' }, 'gpt-6-luna').doStream({ prompt })).rejects.toMatchObject({ statusCode: status });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it.each(models)('%s: LangChain text uses the same API', async modelId => {
    const { adapter, requests } = fixture((_b, r) => r ? response([text]) : chat({ role: 'assistant', content: 'Done' }));
    const model = adapter.createLangchainModel({ apiKey: 'fixture' }, modelId, { temperature: .7, topP: .9, maxTokens: 80 });
    const answer = await model.invoke('Hello');
    expect(answer.text).toBe('Done'); expect(requests[0].body.model).toBe(modelId);
    expect(requests[0].url.endsWith(modelId.startsWith('gpt-6') ? '/responses' : '/chat/completions')).toBe(true);
    if (modelId.startsWith('gpt-6')) { expect(requests[0].body.temperature).toBeUndefined(); expect(requests[0].body.top_p).toBeUndefined(); }
  });
});

describe('OpenAI streaming with real SDK', () => {
  it.each(models)('%s: text deltas and finish usage survive streaming', async modelId => {
    const adapter = new OpenAIAdapter(); const requests: any[] = [];
    adapter.setSafeFetch(async (url, init) => {
      const body = JSON.parse(init!.body as string); requests.push(body);
      const events = String(url).endsWith('/responses') ? [
        { type: 'response.created', response: { id: 'resp_1', created_at: 1, model: modelId } },
        { type: 'response.output_item.added', output_index: 0, item: { id: 'msg_1', type: 'message', role: 'assistant', content: [] } },
        { type: 'response.output_text.delta', item_id: 'msg_1', output_index: 0, content_index: 0, delta: 'Done' },
        { type: 'response.output_item.done', output_index: 0, item: { ...text, id: 'msg_1' } },
        { type: 'response.completed', response: response([text]) },
      ] : [
        { id: 'chat_1', created: 1, model: modelId, choices: [{ index: 0, delta: { role: 'assistant', content: 'Done' }, finish_reason: null }] },
        { id: 'chat_1', created: 1, model: modelId, choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 7 } },
      ];
      return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await adapter.createLanguageModel({ apiKey: 'fixture' }, modelId).doStream({ prompt });
    const chunks: any[] = []; for await (const chunk of result.stream) chunks.push(chunk);
    expect(requests[0].stream).toBe(true);
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'text-delta', delta: 'Done' }));
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'finish', usage: expect.objectContaining({ inputTokens: 12, outputTokens: 7 }) }));
    expect(chunks.filter(c => c.type === 'error')).toEqual([]);
  });
});


describe('agent framework compatibility', () => {
  it.each(models)('%s: Mastra executes tools and finishes', async modelId => {
    const { adapter, requests } = fixture((_b, r, n) => n > 2
      ? (r ? response([text]) : chat({ role: 'assistant', content: 'Done' }))
      : (r ? response([{ type: 'function_call', id: `fc_${n}`, call_id: `call_${n}`, name: 'lookup', arguments: '{"value":"test"}' }])
        : chat({ role: 'assistant', content: null, tool_calls: [{ id: `call_${n}`, type: 'function', function: { name: 'lookup', arguments: '{"value":"test"}' } }] })));
    const execute = vi.fn(async () => ({ result: 'tool-result' }));
    const agent = new Agent({ id: 'fixture', name: 'fixture', instructions: 'Only use fixture tools', model: adapter.createLanguageModel({ apiKey: 'fixture' }, modelId), tools: {
      lookup: createTool({ id: 'lookup', description: 'Fixture', inputSchema: z.object({ value: z.string() }), execute }),
    } });
    const result = await agent.generate('Look up twice', { maxSteps: 3 });
    expect(result.text).toBe('Done'); expect(execute).toHaveBeenCalledTimes(2); expect(requests).toHaveLength(3);
  });

  it.each(models)('%s: LangChain tool results round trip twice', async modelId => {
    const { adapter, requests } = fixture((_b, r, n) => n > 2
      ? (r ? response([text]) : chat({ role: 'assistant', content: 'Done' }))
      : (r ? response([{ type: 'function_call', id: `fc_${n}`, call_id: `call_${n}`, name: 'lookup', arguments: '{"value":"test"}' }])
        : chat({ role: 'assistant', content: null, tool_calls: [{ id: `call_${n}`, type: 'function', function: { name: 'lookup', arguments: '{"value":"test"}' } }] })));
    const model = (adapter.createLangchainModel({ apiKey: 'fixture' }, modelId) as any).bindTools([{ name: 'lookup', description: 'Fixture', schema: z.object({ value: z.string() }) }]);
    const messages: any[] = [new HumanMessage('Look up twice')];
    for (let n = 1; n <= 2; n++) {
      const reply: AIMessage = await model.invoke(messages, { reasoning: { effort: 'high' } });
      expect(reply.tool_calls?.[0].id).toBe(`call_${n}`);
      messages.push(reply, new ToolMessage({ tool_call_id: `call_${n}`, content: 'tool-result' }));
    }
    expect((await model.invoke(messages)).text).toBe('Done');
    if (modelId.startsWith('gpt-6')) {
      expect(requests[0].body.reasoning.effort).toBe('high');
      expect(requests[2].body.input).toContainEqual(expect.objectContaining({ type: 'function_call_output', call_id: 'call_2', output: 'tool-result' }));
    }
  });
});

describe('streaming function calls', () => {
  it.each(models)('%s: incremental arguments retain call ID and tool finish reason', async modelId => {
    const adapter = new OpenAIAdapter();
    adapter.setSafeFetch(async url => {
      const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'lookup', arguments: '{"value":"test"}', status: 'completed' };
      const events = String(url).endsWith('/responses') ? [
        { type: 'response.output_item.added', output_index: 0, item: { ...call, arguments: '', status: 'in_progress' } },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '{"value":' },
        { type: 'response.function_call_arguments.delta', item_id: 'fc_1', output_index: 0, delta: '"test"}' },
        { type: 'response.output_item.done', output_index: 0, item: call },
        { type: 'response.completed', response: response([call]) },
      ] : [
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call_1', type: 'function', function: { name: 'lookup', arguments: '{"value":' } }] }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '"test"}' } }] }, finish_reason: 'tool_calls' }] },
      ];
      return new Response(events.map(e => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    });
    const result = await adapter.createLanguageModel({ apiKey: 'fixture' }, modelId).doStream({ prompt, tools: [{ type: 'function', name: 'lookup', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }] });
    const chunks: any[] = []; for await (const chunk of result.stream) chunks.push(chunk);
    expect(chunks.filter(c => c.type === 'error')).toEqual([]);
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'tool-call', toolCallId: 'call_1', toolName: 'lookup', input: '{"value":"test"}' }));
    expect(chunks).toContainEqual(expect.objectContaining({ type: 'finish', finishReason: 'tool-calls' }));
  });

  it('Terra does not forward an unsupported reasoning effort', async () => {
    const { adapter, requests } = fixture(() => response([text]));
    const result = await adapter.createLanguageModel({ apiKey: 'fixture' }, 'gpt-6.1-terra').doGenerate({ prompt, providerOptions: { openai: { reasoningEffort: 'none' } } });
    expect(requests[0].body.reasoning).toBeUndefined();
    expect(result.warnings).toContainEqual(expect.objectContaining({ type: 'unsupported-setting', setting: 'reasoningEffort' }));
  });

  it('custom endpoints fail closed without safe fetch in both SDK factories', () => {
    const adapter = new OpenAIAdapter();
    for (const factory of [adapter.createLanguageModel, adapter.createLangchainModel])
      expect(() => factory.call(adapter, { apiKey: 'fixture', baseURL: 'https://example.com/v1' }, 'gpt-6-luna')).toThrow('requires safe fetch');
  });
});

describe('catalog and transport', () => {
  it('keeps requested stored defaults in the fallback catalog when model listing fails', async () => {
    const adapter = new OpenAIAdapter(); adapter.setSafeFetch(async () => new Response('', { status: 503 }));
    const catalog = await adapter.listModels({ apiKey: 'fixture' });
    for (const id of models) expect(catalog.some(m => m.id === id)).toBe(true);
  });

  it('adapts Request inputs without losing body, headers or abort signal', async () => {
    const adapter = new OpenAIAdapter(); const fetch = vi.fn(async () => new Response('{}')); adapter.setSafeFetch(fetch);
    const controller = new AbortController();
    await (adapter as any)._sdkFetch()(new Request('https://example.com/v1/responses', { method: 'POST', headers: { 'x-fixture': 'yes' }, body: 'fixture', signal: controller.signal }));
    const [url, init] = fetch.mock.calls[0] as any;
    expect(url).toBe('https://example.com/v1/responses'); expect(init.method).toBe('POST'); expect(init.headers.get('x-fixture')).toBe('yes');
    expect(new TextDecoder().decode(init.body)).toBe('fixture'); controller.abort(); expect(init.signal.aborted).toBe(true);
  });
});


it.each(['gpt-4o', 'gpt-4o-mini', 'gpt-5.2', 'o3'])('preserves the existing AI SDK Chat route for %s', async modelId => {
  const { adapter, requests } = fixture(() => chat({ role: 'assistant', content: 'Done' }));
  await adapter.createLanguageModel({ apiKey: 'fixture' }, modelId).doGenerate({ prompt });
  expect(requests[0].url.endsWith('/chat/completions')).toBe(true);
  expect(requests[0].body.model).toBe(modelId);
});
