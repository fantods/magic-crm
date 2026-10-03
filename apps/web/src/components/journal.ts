import type { SchemaEvent } from '@formless/contracts';

export type SchemaEventKind = 'proposed' | 'accepted' | 'rejected' | 'merged' | 'created';

export interface SchemaEventDescription {
  readonly kind: SchemaEventKind;
  readonly summary: string;
  readonly detail?: string;
}

function text(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === 'string' ? value : undefined;
}

function textList(payload: Record<string, unknown>, key: string): string[] {
  const value = payload[key];
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

/**
 * Renders one append-only journal entry (PLAN.md, "Audit/journal panel"):
 * the architect proposal, the reviewer decision, its rationale, and the
 * accepted/rejected/merged outcome.
 */
export function describeSchemaEvent(event: SchemaEvent): SchemaEventDescription {
  const payload = event.payload;

  switch (event.eventType) {
    case 'table_proposed': {
      const name = text(payload, 'name');
      const description = text(payload, 'description');
      const aliases = textList(payload, 'aliases');
      const parts = [
        description === undefined ? undefined : `Description: ${description}`,
        aliases.length > 0 ? `Aliases: ${aliases.join(', ')}` : undefined,
      ].filter((item): item is string => item !== undefined);
      return {
        kind: 'proposed',
        summary:
          name === undefined
            ? 'Architect proposed reusing an existing table'
            : `Architect proposed a new table “${name}”`,
        ...(parts.length > 0 ? { detail: parts.join(' · ') } : {}),
      };
    }
    case 'table_accepted': {
      const name = text(payload, 'name');
      const rationale = text(payload, 'rationale');
      return {
        kind: 'accepted',
        summary: `Reviewer accepted table “${name ?? 'unknown'}”`,
        ...(rationale === undefined ? {} : { detail: rationale }),
      };
    }
    case 'column_proposed': {
      const name = text(payload, 'name');
      const type = text(payload, 'type');
      const evidence = payload['evidence'];
      const evidenceText =
        typeof evidence === 'object' && evidence !== null && 'text' in evidence
          ? (evidence as { text: unknown }).text
          : undefined;
      return {
        kind: 'proposed',
        summary: `Architect proposed column “${name ?? 'unknown'}”${type === undefined ? '' : ` (${type})`}`,
        ...(typeof evidenceText === 'string' ? { detail: `Source phrase: “${evidenceText}”` } : {}),
      };
    }
    case 'column_accepted': {
      const name = text(payload, 'name');
      const type = text(payload, 'type');
      const rationale = text(payload, 'rationale');
      return {
        kind: 'accepted',
        summary: `Reviewer accepted column “${name ?? 'unknown'}”${type === undefined ? '' : ` (${type})`}`,
        ...(rationale === undefined ? {} : { detail: rationale }),
      };
    }
    case 'column_merged': {
      const alias = text(payload, 'alias');
      const rationale = text(payload, 'rationale');
      return {
        kind: 'merged',
        summary: `Reviewer merged “${alias ?? 'unknown'}” into an existing column`,
        ...(rationale === undefined ? {} : { detail: rationale }),
      };
    }
    case 'column_rejected': {
      const name = text(payload, 'proposedName');
      const type = text(payload, 'proposedType');
      const reason = text(payload, 'reason');
      return {
        kind: 'rejected',
        summary: `Reviewer rejected column “${name ?? 'unknown'}”${type === undefined ? '' : ` (${type})`}`,
        ...(reason === undefined ? {} : { detail: reason }),
      };
    }
    case 'record_created': {
      const rejectedKeys = textList(payload, 'rejectedFieldKeys');
      return {
        kind: 'created',
        summary: 'Record created from the email',
        ...(rejectedKeys.length > 0
          ? { detail: `Ignored one-off fields: ${rejectedKeys.join(', ')}` }
          : {}),
      };
    }
    default: {
      return {
        kind: 'created',
        summary: `Schema event ${event.eventType}`,
      };
    }
  }
}
