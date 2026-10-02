import { describe, expect, it } from 'vitest';
import { ModelCallFailure } from './errors.js';
import {
  OpenAiResponsesClient,
  type FetchInitLike,
  type FetchLike,
  type FetchResponseLike,
} from './responses-client.js';

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): FetchResponseLike {
  return {
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
    },
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function wireSuccess(
  outputText: string,
  options: {
    headers?: Record<string, string>;
    id?: string;
    usage?: unknown;
    status?: string;
  } = {},
): FetchResponseLike {
  return jsonResponse(
    200,
    {
      id: options.id ?? 'resp_test',
      object: 'response',
      status: options.status ?? 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: outputText, annotations: [] }],
        },
      ],
      usage: options.usage,
    },
    options.headers,
  );
}

function fetchSequence(responses: Array<FetchResponseLike | Error>): {
  fetchImpl: FetchLike;
  inits: FetchInitLike[];
  urls: string[];
} {
  const inits: FetchInitLike[] = [];
  const urls: string[] = [];
  let index = 0;
  const fetchImpl: FetchLike = async (url, init) => {
    urls.push(url);
    inits.push(init);
    const next = responses[index];
    index += 1;
    if (next === undefined) {
      throw new Error(`unexpected fetch call ${index}`);
    }
    if (next instanceof Error) {
      throw next;
    }
    return next;
  };
  return { fetchImpl, inits, urls };
}

function abortingFetch(): FetchLike {
  return (_url, init) =>
    new Promise<FetchResponseLike>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        reject(new DOMException('This operation was aborted', 'AbortError'));
      });
    });
}

interface Harness {
  readonly inits: FetchInitLike[];
  readonly urls: string[];
  readonly sleeps: number[];
  makeClient(
    options?: Partial<ConstructorParameters<typeof OpenAiResponsesClient>[0]>,
  ): OpenAiResponsesClient;
}

function harness(responses: Array<FetchResponseLike | Error>): Harness {
  const sequence = fetchSequence(responses);
  const sleeps: number[] = [];
  let clock = 1_000;
  return {
    inits: sequence.inits,
    urls: sequence.urls,
    sleeps,
    makeClient(options = {}) {
      return new OpenAiResponsesClient({
        apiKey: 'sk-test',
        fetch: sequence.fetchImpl,
        sleep: async (ms) => {
          sleeps.push(ms);
        },
        now: () => (clock += 100),
        ...options,
      });
    },
  };
}

const identityParse = (raw: unknown) => raw as { value: string };

const sampleRequest = {
  purpose: 'architect_proposal' as const,
  systemPrompt: 'system prompt',
  userContent: '{"hello":"world"}',
  schemaName: 'architect_proposal',
  jsonSchema: { type: 'object' } as const,
  parse: identityParse,
};

describe('OpenAiResponsesClient', () => {
  it('returns parsed output with operational metadata on success', async () => {
    const h = harness([
      wireSuccess('{"value":"ok"}', {
        headers: { 'x-request-id': 'req_123' },
        usage: {
          input_tokens: 120,
          output_tokens: 45,
          total_tokens: 165,
          output_tokens_details: { reasoning_tokens: 12 },
        },
      }),
    ]);
    const client = h.makeClient();

    const result = await client.callStructuredOutput(sampleRequest);

    expect(result.output).toEqual({ value: 'ok' });
    expect(result.metadata).toEqual({
      purpose: 'architect_proposal',
      model: 'gpt-5.1',
      attempts: 1,
      latencyMs: 100,
      inputTokens: 120,
      outputTokens: 45,
      totalTokens: 165,
      reasoningTokens: 12,
      requestId: 'req_123',
      responseId: 'resp_test',
    });
  });

  it('sends a strict structured-output Responses API request', async () => {
    const h = harness([wireSuccess('{"value":"ok"}')]);
    const client = h.makeClient({ model: 'gpt-4o', storeResponses: true });

    await client.callStructuredOutput(sampleRequest);

    expect(h.urls).toEqual(['https://api.openai.com/v1/responses']);
    const init = h.inits[0]!;
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(init.headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body) as {
      model: string;
      input: { role: string; content: string }[];
      text: { format: { type: string; name: string; strict: boolean } };
      store: boolean;
    };
    expect(body.model).toBe('gpt-4o');
    expect(body.input).toEqual([
      { role: 'system', content: 'system prompt' },
      { role: 'user', content: '{"hello":"world"}' },
    ]);
    expect(body.text.format).toEqual({
      type: 'json_schema',
      name: 'architect_proposal',
      strict: true,
      schema: { type: 'object' },
    });
    expect(body.store).toBe(true);
  });

  it('omits token metadata when the response has no usage', async () => {
    const h = harness([wireSuccess('{"value":"ok"}', { usage: undefined })]);
    const client = h.makeClient();

    const result = await client.callStructuredOutput(sampleRequest);

    expect(result.metadata.inputTokens).toBeUndefined();
    expect(result.metadata.totalTokens).toBeUndefined();
  });

  it('retries transient server failures and succeeds on the second attempt', async () => {
    const h = harness([
      jsonResponse(503, { error: { message: 'service unavailable', code: 'server_error' } }),
      wireSuccess('{"value":"ok"}'),
    ]);
    const client = h.makeClient();

    const result = await client.callStructuredOutput(sampleRequest);

    expect(result.output).toEqual({ value: 'ok' });
    expect(result.metadata.attempts).toBe(2);
    expect(h.sleeps).toEqual([250]);
  });

  it('honors Retry-After seconds for rate limits', async () => {
    const h = harness([
      jsonResponse(
        429,
        { error: { message: 'rate limited', code: 'rate_limit_exceeded' } },
        { 'retry-after': '2' },
      ),
      wireSuccess('{"value":"ok"}'),
    ]);
    const client = h.makeClient();

    await client.callStructuredOutput(sampleRequest);

    expect(h.sleeps).toEqual([2_000]);
  });

  it('retries network failures with exponential backoff, then fails typed', async () => {
    const h = harness([
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
      new TypeError('fetch failed'),
    ]);
    const client = h.makeClient();

    const failure = await client
      .callStructuredOutput(sampleRequest)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ModelCallFailure);
    const typed = failure as ModelCallFailure;
    expect(typed.kind).toBe('network');
    expect(typed.retryable).toBe(true);
    expect(typed.details.attempts).toBe(3);
    expect(typed.details.model).toBe('gpt-5.1');
    expect(h.sleeps).toEqual([250, 500]);
    expect(typed.message).not.toContain('fetch failed');
  });

  it('never retries invalid requests', async () => {
    const h = harness([
      jsonResponse(400, {
        error: { message: 'Invalid schema for response_format', code: 'invalid_json_schema' },
      }),
    ]);
    const client = h.makeClient();

    const failure = (await client
      .callStructuredOutput(sampleRequest)
      .catch((error: unknown) => error)) as ModelCallFailure;

    expect(failure).toBeInstanceOf(ModelCallFailure);
    expect(failure.kind).toBe('invalid_request');
    expect(failure.retryable).toBe(false);
    expect(failure.details.attempts).toBe(1);
    expect(failure.details.status).toBe(400);
    expect(failure.details.providerCode).toBe('invalid_json_schema');
    expect(h.sleeps).toEqual([]);
  });

  it.each([
    [408, 'timeout'],
    [429, 'rate_limited'],
    [500, 'server'],
    [503, 'server'],
  ])('maps HTTP %i to kind %s', async (status, expectedKind) => {
    const h = harness([jsonResponse(status, { error: { message: 'boom' } })]);
    const client = h.makeClient({ retry: { maxAttempts: 1 } });

    const failure = (await client
      .callStructuredOutput(sampleRequest)
      .catch((error: unknown) => error)) as ModelCallFailure;

    expect(failure.kind).toBe(expectedKind);
    expect(failure.details.status).toBe(status);
  });

  it('classifies aborted requests as timeouts and retries them', async () => {
    const sleeps: number[] = [];
    const client = new OpenAiResponsesClient({
      apiKey: 'sk-test',
      timeoutMs: 10,
      retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1 },
      fetch: abortingFetch(),
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    const failure = (await client
      .callStructuredOutput(sampleRequest)
      .catch((error: unknown) => error)) as ModelCallFailure;

    expect(failure).toBeInstanceOf(ModelCallFailure);
    expect(failure.kind).toBe('timeout');
    expect(failure.details.attempts).toBe(2);
    expect(sleeps).toEqual([1]);
  });

  it('fails typed on non-JSON model output without retrying', async () => {
    const h = harness([wireSuccess('not json at all')]);
    const client = h.makeClient();

    const failure = (await client
      .callStructuredOutput(sampleRequest)
      .catch((error: unknown) => error)) as ModelCallFailure;

    expect(failure.kind).toBe('invalid_output');
    expect(failure.details.attempts).toBe(1);
    expect(h.sleeps).toEqual([]);
  });

  it('fails typed when the parse function rejects the output', async () => {
    const h = harness([wireSuccess('{"value":"ok"}')]);
    const client = h.makeClient();

    const failure = (await client
      .callStructuredOutput({
        ...sampleRequest,
        parse: () => {
          throw new Error('schema validation failed: bad shape');
        },
      })
      .catch((error: unknown) => error)) as ModelCallFailure;

    expect(failure.kind).toBe('invalid_output');
    expect(failure.message).toContain('schema validation failed');
  });

  it('fails typed on incomplete responses without retrying', async () => {
    const h = harness([
      wireSuccess('{"value":"ok"}', {
        status: 'incomplete',
        usage: undefined,
      }),
    ]);
    const client = h.makeClient();

    const failure = (await client
      .callStructuredOutput(sampleRequest)
      .catch((error: unknown) => error)) as ModelCallFailure;

    expect(failure.kind).toBe('invalid_output');
    expect(failure.message).toContain('incomplete');
  });

  it('treats a 2xx response with a non-JSON body as a transient server failure', async () => {
    const h = harness([jsonResponse(200, '<html>gateway</html>'), wireSuccess('{"value":"ok"}')]);
    const client = h.makeClient();

    const result = await client.callStructuredOutput(sampleRequest);

    expect(result.metadata.attempts).toBe(2);
  });

  it('truncates provider messages so echoed email bodies are never logged whole', async () => {
    const echoedBody = `Your email: ${'x'.repeat(1_500)}`;
    const h = harness([jsonResponse(400, { error: { message: echoedBody } })]);
    const client = h.makeClient();

    const failure = (await client
      .callStructuredOutput(sampleRequest)
      .catch((error: unknown) => error)) as ModelCallFailure;

    expect(failure.message.length).toBeLessThan(500);
    expect(failure.message).not.toContain('x'.repeat(1_000));
  });

  it('emits metadata through the onCall observer', async () => {
    const observed: unknown[] = [];
    const h = harness([wireSuccess('{"value":"ok"}')]);
    const client = h.makeClient({ onCall: (metadata) => observed.push(metadata) });

    await client.callStructuredOutput(sampleRequest);

    expect(observed).toHaveLength(1);
    expect((observed[0] as { purpose: string }).purpose).toBe('architect_proposal');
  });
});
