import { describe, expect, it } from 'vitest';
import { normalizeEmail } from './normalize-email.js';

describe('normalizeEmail', () => {
  it('normalizes line endings, whitespace, and removes quoted replies', () => {
    const normalized = normalizeEmail({
      workspaceId: 'demo',
      subject: '  Site   expansion  ',
      body: 'We have three clinics.\r\n\r\nOn Tue, someone wrote:\r\n> Old message',
      from: ' ops@example.com ',
    });

    expect(normalized.subject).toBe('Site expansion');
    expect(normalized.body).toBe('We have three clinics.');
    expect(normalized.from).toBe('ops@example.com');
    expect(normalized.originalBody).toContain('Old message');
  });

  it('derives a stable idempotency key and content hash', () => {
    const input = {
      workspaceId: 'demo',
      body: 'We have three clinics.',
    };
    const first = normalizeEmail(input);
    const second = normalizeEmail(input);

    expect(first.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.idempotencyKey).toBe(`email_${first.contentHash}`);
    expect(second.contentHash).toBe(first.contentHash);
  });

  it('preserves an explicit idempotency key', () => {
    const normalized = normalizeEmail({
      workspaceId: 'demo',
      body: 'We have three clinics.',
      idempotencyKey: 'external-key',
    });

    expect(normalized.idempotencyKey).toBe('external-key');
  });
});
