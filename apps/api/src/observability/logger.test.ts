import { describe, expect, it } from 'vitest';
import type { ModelCallMetadata } from '@formless/openai';
import { OperationalLogger } from './logger.js';

function capture(): { lines: string[]; logger: OperationalLogger } {
  const lines: string[] = [];
  const logger = new OperationalLogger({
    writeLine: (line) => lines.push(line),
    now: () => Date.parse('2026-02-10T12:00:00Z'),
  });
  return { lines, logger };
}

describe('OperationalLogger', () => {
  it('emits one JSON object per line with level, message, and fields', () => {
    const { lines, logger } = capture();
    logger.info('request_handled', { method: 'POST', status_code: 201 });
    logger.warn('degraded', { retries: 2 });
    logger.error('failed', { route: '/x' });

    expect(lines).toHaveLength(3);
    expect(lines.map((line) => JSON.parse(line))).toEqual([
      {
        time: '2026-02-10T12:00:00.000Z',
        level: 'info',
        msg: 'request_handled',
        method: 'POST',
        status_code: 201,
      },
      { time: '2026-02-10T12:00:00.000Z', level: 'warn', msg: 'degraded', retries: 2 },
      { time: '2026-02-10T12:00:00.000Z', level: 'error', msg: 'failed', route: '/x' },
    ]);
  });

  it('emits the model adapter call metadata as structured fields', () => {
    const { lines, logger } = capture();
    const metadata: ModelCallMetadata = {
      purpose: 'architect_proposal',
      model: 'gpt-5.1',
      attempts: 2,
      latencyMs: 1234,
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      reasoningTokens: 10,
      requestId: 'req_1',
      responseId: 'resp_1',
    };
    logger.modelCall(metadata);

    expect(JSON.parse(lines[0]!)).toEqual({
      time: '2026-02-10T12:00:00.000Z',
      level: 'info',
      msg: 'model_call',
      purpose: 'architect_proposal',
      model: 'gpt-5.1',
      attempts: 2,
      latency_ms: 1234,
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
      reasoning_tokens: 10,
      request_id: 'req_1',
      response_id: 'resp_1',
    });
  });

  it('never emits redacted keys such as request bodies or credentials', () => {
    const { lines, logger } = capture();
    logger.info('ingestion', {
      body: 'We operate three clinics and our budget is secret.',
      emailBody: 'secret body',
      input: 'secret input',
      authorization: 'Bearer sk-secret',
      apiKey: 'sk-secret',
      workspaceId: 'demo',
    } as Record<string, string>);

    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(parsed.workspaceId).toBe('demo');
    expect(JSON.stringify(parsed)).not.toContain('secret');
    expect(JSON.stringify(parsed)).not.toContain('three clinics');
  });
});
