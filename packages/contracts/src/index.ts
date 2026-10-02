import { z } from 'zod';

export const workspaceIdSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/, 'Workspace ID must be a lowercase slug');

export const columnTypeSchema = z.enum([
  'text',
  'integer',
  'decimal',
  'boolean',
  'date',
  'datetime',
  'enum',
  'email',
  'url',
  'json',
]);

export const isoDateTimeSchema = z.string().datetime({ offset: true });

export const jsonObjectSchema = z.record(z.string(), z.unknown());

export const ingestionStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed']);

export const schemaEventTypeSchema = z.enum([
  'table_proposed',
  'table_accepted',
  'table_rejected',
  'column_proposed',
  'column_accepted',
  'column_rejected',
  'column_merged',
  'record_created',
]);

export const recordColumnSchema = z.object({
  id: z.string().min(1),
  workspaceId: workspaceIdSchema,
  tableId: z.string().min(1),
  name: z.string().min(1).max(100),
  type: columnTypeSchema,
  description: z.string().max(2_000).optional(),
  aliases: z.array(z.string().min(1).max(100)).max(100),
  unit: z.string().min(1).max(50).optional(),
  enumValues: z.array(z.string().min(1).max(100)).max(500).optional(),
  createdAt: isoDateTimeSchema,
});

export const recordTableSchema = z.object({
  id: z.string().min(1),
  workspaceId: workspaceIdSchema,
  name: z.string().min(1).max(100),
  description: z.string().max(2_000).optional(),
  aliases: z.array(z.string().min(1).max(100)).max(100),
  createdAt: isoDateTimeSchema,
});

export const workspaceSchema = z.object({
  id: workspaceIdSchema,
  displayName: z.string().min(1).max(100),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const schemaEventSchema = z.object({
  id: z.string().uuid(),
  workspaceId: workspaceIdSchema,
  sequence: z.number().int().positive(),
  ingestionId: z.string().uuid(),
  eventType: schemaEventTypeSchema,
  payload: jsonObjectSchema,
  actor: jsonObjectSchema,
  createdAt: isoDateTimeSchema,
});

export const sourceEvidenceSchema = z.object({
  source: z.enum(['subject', 'body', 'from', 'to']),
  text: z.string().min(1),
  startIndex: z.number().int().nonnegative().optional(),
  endIndex: z.number().int().positive().optional(),
});

export const recordSourceSchema = z.object({
  subject: z.string().max(998).optional(),
  body: z.string().max(200_000),
  from: z.string().max(320).optional(),
  to: z.string().max(320).optional(),
  receivedAt: isoDateTimeSchema.optional(),
});

export const recordSchema = z.object({
  id: z.string().uuid(),
  workspaceId: workspaceIdSchema,
  tableId: z.string().uuid(),
  data: jsonObjectSchema,
  evidence: z.record(z.string(), z.array(sourceEvidenceSchema)),
  source: recordSourceSchema,
  schemaRevision: z.number().int().positive(),
  contentHash: z.string().length(64),
  idempotencyKey: z.string().min(8).max(128),
  createdAt: isoDateTimeSchema,
});

export const ingestionSchema = z.object({
  id: z.string().uuid(),
  workspaceId: workspaceIdSchema,
  idempotencyKey: z.string().min(8).max(128),
  status: ingestionStatusSchema,
  input: jsonObjectSchema,
  normalized: jsonObjectSchema.optional(),
  result: jsonObjectSchema.optional(),
  error: z.string().max(8_000).optional(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
});

export const emailIngestionInputSchema = z.object({
  workspaceId: workspaceIdSchema,
  subject: z.string().max(998).optional(),
  body: z.string().min(1).max(200_000),
  from: z.string().max(320).optional(),
  to: z.string().max(320).optional(),
  receivedAt: isoDateTimeSchema.optional(),
  idempotencyKey: z.string().min(8).max(128).optional(),
});

export const schemaDeltaSchema = z.object({
  table: recordTableSchema,
  tableCreated: z.boolean(),
  newColumns: z.array(recordColumnSchema),
  mergedColumns: z.array(recordColumnSchema),
  schemaRevision: z.number().int().positive(),
});

export const ingestionResultSchema = z.object({
  schemaDelta: schemaDeltaSchema,
  record: recordSchema,
});

export const ingestEmailResponseSchema = z.object({
  ingestion: ingestionSchema,
  schemaDelta: schemaDeltaSchema,
  record: recordSchema,
});

export const ingestionResponseSchema = z.object({
  ingestion: ingestionSchema,
});

export const schemaEventsResponseSchema = z.object({
  events: z.array(schemaEventSchema),
  total: z.number().int().nonnegative(),
});

export const healthResponseSchema = z.object({
  status: z.literal('ok'),
  service: z.literal('formless-api'),
  version: z.string().min(1),
});

export type WorkspaceId = z.infer<typeof workspaceIdSchema>;
export type ColumnType = z.infer<typeof columnTypeSchema>;
export type RecordColumn = z.infer<typeof recordColumnSchema>;
export type RecordTable = z.infer<typeof recordTableSchema>;
export type Workspace = z.infer<typeof workspaceSchema>;
export type SchemaEvent = z.infer<typeof schemaEventSchema>;
export type SchemaEventType = z.infer<typeof schemaEventTypeSchema>;
export type SourceEvidence = z.infer<typeof sourceEvidenceSchema>;
export type RecordSource = z.infer<typeof recordSourceSchema>;
export type Record = z.infer<typeof recordSchema>;
export type IngestionStatus = z.infer<typeof ingestionStatusSchema>;
export type Ingestion = z.infer<typeof ingestionSchema>;
export type EmailIngestionInput = z.infer<typeof emailIngestionInputSchema>;
export type SchemaDelta = z.infer<typeof schemaDeltaSchema>;
export type IngestionResult = z.infer<typeof ingestionResultSchema>;
export type IngestEmailResponse = z.infer<typeof ingestEmailResponseSchema>;
export type IngestionResponse = z.infer<typeof ingestionResponseSchema>;
export type SchemaEventsResponse = z.infer<typeof schemaEventsResponseSchema>;
export type HealthResponse = z.infer<typeof healthResponseSchema>;
