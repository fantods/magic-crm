import { z } from 'zod';
import {
  columnTypeSchema,
  sourceEvidenceSchema,
  type ColumnType,
  type SourceEvidence,
} from '@formless/contracts';

export const proposalFieldKeySchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9_]{0,99}$/, 'Proposal key must be a snake_case identifier');

export const architectTableTargetSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    tableId: z.string().uuid(),
  }),
  z.object({
    kind: z.literal('new'),
    name: z.string().min(1).max(100),
    description: z.string().max(2_000).optional(),
    aliases: z.array(z.string().min(1).max(100)).max(100),
  }),
]);

export const architectFieldProposalSchema = z.object({
  key: proposalFieldKeySchema,
  columnName: z.string().min(1).max(100),
  type: columnTypeSchema,
  value: z.unknown(),
  enumValues: z.array(z.string().min(1).max(100)).max(500).optional(),
  evidence: sourceEvidenceSchema,
  rationale: z.string().min(1).max(2_000),
});

export const architectProposalSchema = z.object({
  table: architectTableTargetSchema,
  fields: z.array(architectFieldProposalSchema).max(100),
});

export const reviewerTableDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('use_existing'),
    tableId: z.string().uuid(),
    rationale: z.string().min(1).max(2_000),
  }),
  z.object({
    action: z.literal('accept_new'),
    name: z.string().min(1).max(100),
    description: z.string().max(2_000).optional(),
    aliases: z.array(z.string().min(1).max(100)).max(100),
    rationale: z.string().min(1).max(2_000),
  }),
  z.object({
    action: z.literal('reject'),
    rationale: z.string().min(1).max(2_000),
  }),
]);

export const reviewerFieldDecisionSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('accept_new'),
    fieldKey: proposalFieldKeySchema,
    columnName: z.string().min(1).max(100),
    type: columnTypeSchema,
    enumValues: z.array(z.string().min(1).max(100)).max(500).optional(),
    rationale: z.string().min(1).max(2_000),
  }),
  z.object({
    action: z.literal('map_existing'),
    fieldKey: proposalFieldKeySchema,
    existingColumnId: z.string().uuid(),
    rationale: z.string().min(1).max(2_000),
  }),
  z.object({
    action: z.literal('reject'),
    fieldKey: proposalFieldKeySchema,
    rationale: z.string().min(1).max(2_000),
  }),
]);

export const reviewerDecisionSchema = z.object({
  table: reviewerTableDecisionSchema,
  fields: z.array(reviewerFieldDecisionSchema).max(100),
});

export type ProposalFieldKey = z.infer<typeof proposalFieldKeySchema>;
export type ArchitectTableTarget = z.infer<typeof architectTableTargetSchema>;
export type ArchitectFieldProposal = z.infer<typeof architectFieldProposalSchema>;
export type ArchitectProposal = z.infer<typeof architectProposalSchema>;
export type ReviewerTableDecision = z.infer<typeof reviewerTableDecisionSchema>;
export type ReviewerFieldDecision = z.infer<typeof reviewerFieldDecisionSchema>;
export type ReviewerDecision = z.infer<typeof reviewerDecisionSchema>;

export interface FieldProposalWithDecision {
  readonly proposal: ArchitectFieldProposal;
  readonly decision:
    | {
        action: 'accept_new';
        fieldKey: string;
        columnName: string;
        type: ColumnType;
        enumValues?: string[];
        rationale: string;
      }
    | {
        action: 'map_existing';
        fieldKey: string;
        existingColumnId: string;
        rationale: string;
      }
    | {
        action: 'reject';
        fieldKey: string;
        rationale: string;
      };
}

export type EvidenceWithProposal = SourceEvidence;
