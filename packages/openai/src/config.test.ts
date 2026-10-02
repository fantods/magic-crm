import { describe, expect, it } from 'vitest';
import { OpenAiConfigError } from './errors.js';
import { openAiClientOptions, resolveOpenAiConfig } from './config.js';

describe('resolveOpenAiConfig', () => {
  it('requires the server-side API key', () => {
    expect(() => resolveOpenAiConfig({})).toThrow(OpenAiConfigError);
    expect(() => resolveOpenAiConfig({ OPENAI_API_KEY: '  ' })).toThrow(OpenAiConfigError);
  });

  it('defaults the model to gpt-5.1', () => {
    const config = resolveOpenAiConfig({ OPENAI_API_KEY: 'sk-test' });
    expect(config.model).toBe('gpt-5.1');
    expect(config.baseUrl).toBeUndefined();
    expect(config.timeoutMs).toBeUndefined();
  });

  it('reads OPENAI_MODEL, OPENAI_BASE_URL, and OPENAI_TIMEOUT_MS', () => {
    const config = resolveOpenAiConfig({
      OPENAI_API_KEY: 'sk-test',
      OPENAI_MODEL: 'gpt-4o-mini',
      OPENAI_BASE_URL: 'http://localhost:9999/v1 ',
      OPENAI_TIMEOUT_MS: '5000',
    });
    expect(config.model).toBe('gpt-4o-mini');
    expect(config.baseUrl).toBe('http://localhost:9999/v1');
    expect(config.timeoutMs).toBe(5_000);
  });

  it('rejects a non-numeric timeout', () => {
    expect(() =>
      resolveOpenAiConfig({ OPENAI_API_KEY: 'sk-test', OPENAI_TIMEOUT_MS: 'soon' }),
    ).toThrow(OpenAiConfigError);
  });
});

describe('openAiClientOptions', () => {
  it('builds client options with call-site extras layered on top', () => {
    const config = resolveOpenAiConfig({ OPENAI_API_KEY: 'sk-test', OPENAI_MODEL: 'gpt-5.1' });
    const options = openAiClientOptions(config, { onCall: () => undefined });

    expect(options.apiKey).toBe('sk-test');
    expect(options.model).toBe('gpt-5.1');
    expect(options.baseUrl).toBe('https://api.openai.com/v1');
    expect(options.onCall).toBeDefined();
  });
});
