import { createHash, randomUUID } from 'node:crypto';
import { emailIngestionInputSchema, type EmailIngestionInput } from '@formless/contracts';

export interface NormalizedEmail {
  readonly workspaceId: string;
  readonly subject?: string;
  readonly body: string;
  readonly originalBody: string;
  readonly from?: string;
  readonly to?: string;
  readonly receivedAt?: string;
  readonly contentHash: string;
  readonly idempotencyKey: string;
}

const quoteMarkers = [
  /^on .+ wrote:\s*$/i,
  /^-{2,}\s*original message\s*-{2,}$/i,
  /^from:\s+.+\s*$/i,
  /^sent from my (?:iphone|ipad|android)\s*$/i,
];

function collapseWhitespace(value: string): string {
  return value.replace(/[ \t]+/g, ' ').trim();
}

function removeQuotedReply(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  const cutoff = lines.findIndex(
    (line, index) => index > 0 && quoteMarkers.some((marker) => marker.test(line.trim())),
  );

  if (cutoff > 0) {
    return lines.slice(0, cutoff).join('\n').trim();
  }

  return body.replace(/\r\n?/g, '\n').trim();
}

export function normalizeEmail(input: EmailIngestionInput): NormalizedEmail {
  const parsed = emailIngestionInputSchema.parse(input);
  const body = removeQuotedReply(parsed.body);
  const subject = parsed.subject === undefined ? undefined : collapseWhitespace(parsed.subject);
  const from = parsed.from === undefined ? undefined : collapseWhitespace(parsed.from);
  const to = parsed.to === undefined ? undefined : collapseWhitespace(parsed.to);
  const canonicalParts = [
    parsed.workspaceId,
    subject ?? '',
    body,
    from ?? '',
    to ?? '',
    parsed.receivedAt ?? '',
  ];
  const contentHash = createHash('sha256').update(canonicalParts.join('\u0000')).digest('hex');

  if (body.length === 0) {
    throw new Error('Email body cannot be empty after normalization');
  }

  return {
    workspaceId: parsed.workspaceId,
    ...(subject === undefined ? {} : { subject }),
    body,
    originalBody: parsed.body,
    ...(from === undefined ? {} : { from }),
    ...(to === undefined ? {} : { to }),
    ...(parsed.receivedAt === undefined ? {} : { receivedAt: parsed.receivedAt }),
    contentHash,
    idempotencyKey: parsed.idempotencyKey ?? `email_${contentHash}`,
  };
}

export function emailFixtureId(): string {
  return randomUUID();
}
