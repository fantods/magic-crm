/**
 * Structured-output JSON Schemas for the OpenAI Responses API.
 *
 * These schemas are the wire format sent with `text.format = json_schema`
 * (strict mode) for the architect and reviewer passes. They are hand-written
 * in the subset of draft 2020-12 that OpenAI strict mode supports:
 *
 * - every object sets `additionalProperties: false`,
 * - every property appears in `required`; optionality is expressed as a
 *   nullable union (`anyOf` with `type: "null"`), because strict mode forces
 *   the model to emit every key,
 * - no length or pattern constraints (unsupported by strict mode); the Zod
 *   contracts in `@formless/core` enforce those bounds after the call.
 *
 * The Zod contracts are the source of truth. These schemas are equivalent at
 * the structural level (same keys, types, enums, nesting), and every model
 * response is normalized and Zod-validated before domain code sees it
 * (see `normalize-output.ts` and `responses-client.ts`).
 *
 * Note: OpenAI strict mode cannot express objects with arbitrary keys, so the
 * recursive `jsonValue` definition covers scalars and arrays only. Values for
 * `json`-typed columns degrade to that subset until a wire representation for
 * keyed objects (for example key/value pair arrays) is needed.
 */

export interface JsonSchema {
  readonly $ref?: string;
  readonly $defs?: Readonly<Record<string, JsonSchema>>;
  readonly type?: string | readonly string[];
  readonly enum?: readonly unknown[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly additionalProperties?: boolean | JsonSchema;
  readonly items?: JsonSchema;
  readonly anyOf?: readonly JsonSchema[];
  readonly description?: string;
}

const columnTypeEnum = [
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
] as const;

function nullable(schema: JsonSchema): JsonSchema {
  return { anyOf: [schema, { type: 'null' }] };
}

const sourceEvidenceSchema: JsonSchema = {
  type: 'object',
  properties: {
    source: { type: 'string', enum: ['subject', 'body', 'from', 'to'] },
    text: { type: 'string' },
    startIndex: nullable({ type: 'integer' }),
    endIndex: nullable({ type: 'integer' }),
  },
  required: ['source', 'text', 'startIndex', 'endIndex'],
  additionalProperties: false,
};

const jsonValueSchema: JsonSchema = {
  anyOf: [
    { type: 'string' },
    { type: 'number' },
    { type: 'boolean' },
    { type: 'null' },
    { type: 'array', items: { $ref: '#/$defs/jsonValue' } },
  ],
};

const architectFieldSchema: JsonSchema = {
  type: 'object',
  properties: {
    key: { type: 'string' },
    columnName: { type: 'string' },
    type: { $ref: '#/$defs/columnType' },
    value: { $ref: '#/$defs/jsonValue' },
    enumValues: nullable({ type: 'array', items: { type: 'string' } }),
    evidence: { $ref: '#/$defs/sourceEvidence' },
    rationale: { type: 'string' },
  },
  required: ['key', 'columnName', 'type', 'value', 'enumValues', 'evidence', 'rationale'],
  additionalProperties: false,
};

/**
 * Wire schema for the architect proposal pass. Structurally equivalent to
 * `architectProposalSchema` in `@formless/core/model-contracts`.
 */
export const architectProposalJsonSchema: JsonSchema = {
  type: 'object',
  properties: {
    table: {
      anyOf: [
        {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['existing'] },
            tableId: { type: 'string' },
          },
          required: ['kind', 'tableId'],
          additionalProperties: false,
        },
        {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['new'] },
            name: { type: 'string' },
            description: nullable({ type: 'string' }),
            aliases: { type: 'array', items: { type: 'string' } },
          },
          required: ['kind', 'name', 'description', 'aliases'],
          additionalProperties: false,
        },
      ],
    },
    fields: { type: 'array', items: { $ref: '#/$defs/architectField' } },
  },
  required: ['table', 'fields'],
  additionalProperties: false,
  $defs: {
    columnType: { type: 'string', enum: [...columnTypeEnum] },
    jsonValue: jsonValueSchema,
    sourceEvidence: sourceEvidenceSchema,
    architectField: architectFieldSchema,
  },
};

const reviewerTableDecisionSchema: JsonSchema = {
  anyOf: [
    {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['use_existing'] },
        tableId: { type: 'string' },
        rationale: { type: 'string' },
      },
      required: ['action', 'tableId', 'rationale'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['accept_new'] },
        name: { type: 'string' },
        description: nullable({ type: 'string' }),
        aliases: { type: 'array', items: { type: 'string' } },
        rationale: { type: 'string' },
      },
      required: ['action', 'name', 'description', 'aliases', 'rationale'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['reject'] },
        rationale: { type: 'string' },
      },
      required: ['action', 'rationale'],
      additionalProperties: false,
    },
  ],
};

const reviewerFieldDecisionSchema: JsonSchema = {
  anyOf: [
    {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['accept_new'] },
        fieldKey: { type: 'string' },
        columnName: { type: 'string' },
        type: { $ref: '#/$defs/columnType' },
        enumValues: nullable({ type: 'array', items: { type: 'string' } }),
        rationale: { type: 'string' },
      },
      required: ['action', 'fieldKey', 'columnName', 'type', 'enumValues', 'rationale'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['map_existing'] },
        fieldKey: { type: 'string' },
        existingColumnId: { type: 'string' },
        rationale: { type: 'string' },
      },
      required: ['action', 'fieldKey', 'existingColumnId', 'rationale'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['reject'] },
        fieldKey: { type: 'string' },
        rationale: { type: 'string' },
      },
      required: ['action', 'fieldKey', 'rationale'],
      additionalProperties: false,
    },
  ],
};

/**
 * Wire schema for the reviewer decision pass. Structurally equivalent to
 * `reviewerDecisionSchema` in `@formless/core/model-contracts`.
 */
export const reviewerDecisionJsonSchema: JsonSchema = {
  type: 'object',
  properties: {
    table: { $ref: '#/$defs/reviewerTableDecision' },
    fields: { type: 'array', items: { $ref: '#/$defs/reviewerFieldDecision' } },
  },
  required: ['table', 'fields'],
  additionalProperties: false,
  $defs: {
    columnType: { type: 'string', enum: [...columnTypeEnum] },
    reviewerTableDecision: reviewerTableDecisionSchema,
    reviewerFieldDecision: reviewerFieldDecisionSchema,
  },
};
/**
 * Structural check for the OpenAI strict-mode subset this package emits.
 * Used by tests to keep the hand-written schemas compliant.
 */
export function assertStrictModeCompliant(schema: JsonSchema, root: JsonSchema = schema): void {
  const type = schema.type;

  if (type !== undefined) {
    if (typeof type === 'string') {
      assertSupportedType(type);
    } else {
      for (const entry of type) {
        assertSupportedType(entry);
      }
    }
  }

  if (schema.anyOf !== undefined) {
    if (schema.anyOf.length === 0) {
      throw new Error('strict mode requires anyOf to be non-empty');
    }
    for (const branch of schema.anyOf) {
      assertStrictModeCompliant(branch, root);
    }
  }

  if (schema.$ref !== undefined && !schema.$ref.startsWith('#/$defs/')) {
    throw new Error(`strict mode only supports local $defs refs, got ${schema.$ref}`);
  }
  if (schema.$ref !== undefined) {
    const defName = schema.$ref.slice('#/$defs/'.length);
    const target = root.$defs?.[defName];
    if (target === undefined) {
      throw new Error(`unresolved $ref ${schema.$ref}`);
    }
  }

  if (schema.properties !== undefined) {
    if (schema.additionalProperties !== false) {
      throw new Error('strict mode requires additionalProperties: false on every object');
    }
    const required = new Set(schema.required ?? []);
    for (const key of Object.keys(schema.properties)) {
      if (!required.has(key)) {
        throw new Error(`strict mode requires every property to be listed: ${key}`);
      }
    }
    for (const property of Object.values(schema.properties)) {
      assertStrictModeCompliant(property, root);
    }
  }

  if (schema.items !== undefined) {
    assertStrictModeCompliant(schema.items, root);
  }

  for (const def of Object.values(schema.$defs ?? {})) {
    assertStrictModeCompliant(def, root);
  }
}

const SUPPORTED_TYPES = new Set([
  'string',
  'number',
  'integer',
  'boolean',
  'null',
  'array',
  'object',
]);

function assertSupportedType(type: string): void {
  if (!SUPPORTED_TYPES.has(type)) {
    throw new Error(`strict mode does not support type ${type}`);
  }
}
