import { vi } from 'vitest';
import type {
  HealthResponse,
  IngestEmailResponse,
  QueryResponse,
  RecordsResponse,
  SchemaCatalogResponse,
  SchemaEvent,
  SchemaEventsResponse,
} from '@formless/contracts';

/**
 * Network-free fixtures for the UI flow tests. They mirror the responses the
 * real API produces when it is driven by the deterministic fake models in
 * `@formless/testing` (the "fake model pattern"): the three demo leads fold
 * into one `locations_count` column (3, 6, 18), the support ticket lands in
 * its own table, and the budget question answers from the leads table.
 */

export const demoIds = {
  leadsTableId: 'a0000000-0000-4000-8000-000000000001',
  locationsColumnId: 'a0000000-0000-4000-8000-000000000002',
  budgetColumnId: 'a0000000-0000-4000-8000-000000000003',
  supportTableId: 'a0000000-0000-4000-8000-000000000004',
  errorCodeColumnId: 'a0000000-0000-4000-8000-000000000005',
  blockedColumnId: 'a0000000-0000-4000-8000-000000000006',
} as const;

const at = '2026-02-10T12:00:00Z';

function event(
  sequence: number,
  eventType: SchemaEvent['eventType'],
  payload: Record<string, unknown>,
): SchemaEvent {
  return {
    id: `d0000000-0000-4000-8000-0000000000${String(sequence).padStart(2, '0')}`,
    workspaceId: 'demo',
    sequence,
    ingestionId: 'c0000000-0000-4000-8000-000000000001',
    eventType,
    payload,
    actor: { source: 'ingestion-api', model: 'fake' },
    createdAt: at,
  };
}

export function buildHealth(): HealthResponse {
  return { status: 'ok', service: 'formless-api', version: '0.1.0' };
}

export function buildSchemaCatalog(): SchemaCatalogResponse {
  return {
    workspaceId: 'demo',
    revision: 8,
    tables: [
      {
        table: {
          id: demoIds.leadsTableId,
          workspaceId: 'demo',
          name: 'leads',
          description: 'Inbound sales leads',
          aliases: ['prospect', 'opportunity'],
          createdAt: at,
        },
        columns: [
          {
            id: demoIds.locationsColumnId,
            workspaceId: 'demo',
            tableId: demoIds.leadsTableId,
            name: 'locations_count',
            type: 'integer',
            description: 'Number of sites the sender operates',
            aliases: ['clinics_count', 'depots_count', 'clinics', 'depots'],
            createdAt: at,
          },
          {
            id: demoIds.budgetColumnId,
            workspaceId: 'demo',
            tableId: demoIds.leadsTableId,
            name: 'budget',
            type: 'integer',
            aliases: ['budget'],
            createdAt: at,
          },
        ],
      },
      {
        table: {
          id: demoIds.supportTableId,
          workspaceId: 'demo',
          name: 'support_tickets',
          description: 'Inbound customer support tickets',
          aliases: ['support requests'],
          createdAt: at,
        },
        columns: [
          {
            id: demoIds.errorCodeColumnId,
            workspaceId: 'demo',
            tableId: demoIds.supportTableId,
            name: 'error_code',
            type: 'text',
            aliases: ['error_code'],
            createdAt: at,
          },
          {
            id: demoIds.blockedColumnId,
            workspaceId: 'demo',
            tableId: demoIds.supportTableId,
            name: 'blocks_weekly_review',
            type: 'boolean',
            aliases: ['blocked'],
            createdAt: at,
          },
        ],
      },
    ],
  };
}

export function buildSchemaEvents(): SchemaEventsResponse {
  const events: SchemaEvent[] = [
    event(1, 'table_proposed', {
      name: 'Lead',
      description: 'Inbound sales lead',
      aliases: ['prospect'],
    }),
    event(2, 'table_accepted', {
      tableId: demoIds.leadsTableId,
      name: 'leads',
      description: 'Inbound sales leads',
      aliases: ['prospect', 'opportunity'],
      rationale: 'The email is a distinct sales lead, not a support request.',
    }),
    event(3, 'column_proposed', {
      fieldKey: 'clinic_count',
      columnId: demoIds.locationsColumnId,
      name: 'clinics_count',
      type: 'integer',
      evidence: { source: 'body', text: 'three clinics' },
    }),
    event(4, 'column_accepted', {
      fieldKey: 'clinic_count',
      columnId: demoIds.locationsColumnId,
      name: 'locations_count',
      type: 'integer',
      aliases: ['clinics_count', 'clinics'],
      enumValues: null,
      rationale: 'Clinic count is a repeatable site count concept; use a generic column name.',
    }),
    event(5, 'column_proposed', {
      fieldKey: 'budget',
      columnId: demoIds.budgetColumnId,
      name: 'budget',
      type: 'integer',
      evidence: { source: 'body', text: 'budget of 6500' },
    }),
    event(6, 'column_accepted', {
      fieldKey: 'budget',
      columnId: demoIds.budgetColumnId,
      name: 'budget',
      type: 'integer',
      aliases: ['budget'],
      enumValues: null,
      rationale: 'Budget is durable and useful for lead qualification.',
    }),
    event(7, 'column_merged', {
      columnId: demoIds.locationsColumnId,
      fieldKey: 'depot_count',
      alias: 'depots_count',
      rationale: 'Depots are locations and belong in locations_count.',
    }),
    event(8, 'record_created', {
      tableId: demoIds.leadsTableId,
      columnIds: [demoIds.locationsColumnId, demoIds.budgetColumnId],
      rejectedFieldKeys: [],
    }),
  ];
  return { events, total: events.length };
}

export function buildLeadRecords(): RecordsResponse {
  return {
    records: [
      {
        id: 'b0000000-0000-4000-8000-000000000003',
        workspaceId: 'demo',
        tableId: demoIds.leadsTableId,
        data: { [demoIds.locationsColumnId]: 18 },
        evidence: {
          [demoIds.locationsColumnId]: [{ source: 'body', text: 'eighteen distribution centres' }],
        },
        source: {
          subject: 'Cavendish Retail network',
          body: 'Cavendish Retail owns eighteen distribution centres and wants a phased deployment.',
          from: 'it@cavendishretail.example',
          to: 'sales@magiccrm.example',
        },
        schemaRevision: 8,
        contentHash: 'e'.repeat(64),
        idempotencyKey: 'idempotency-distribution',
        createdAt: at,
      },
      {
        id: 'b0000000-0000-4000-8000-000000000002',
        workspaceId: 'demo',
        tableId: demoIds.leadsTableId,
        data: { [demoIds.locationsColumnId]: 6 },
        evidence: { [demoIds.locationsColumnId]: [{ source: 'body', text: 'six depots' }] },
        source: {
          subject: 'Northgate Logistics site enquiry',
          body: 'Northgate Logistics runs six depots and needs a multi-site rollout.',
          from: 'finance@northgatelogistics.example',
          to: 'sales@magiccrm.example',
        },
        schemaRevision: 8,
        contentHash: 'e'.repeat(64),
        idempotencyKey: 'idempotency-depot',
        createdAt: at,
      },
      {
        id: 'b0000000-0000-4000-8000-000000000001',
        workspaceId: 'demo',
        tableId: demoIds.leadsTableId,
        data: { [demoIds.locationsColumnId]: 3, [demoIds.budgetColumnId]: 6500 },
        evidence: {
          [demoIds.locationsColumnId]: [{ source: 'body', text: 'three clinics' }],
          [demoIds.budgetColumnId]: [{ source: 'body', text: 'budget of 6500' }],
        },
        source: {
          subject: 'Meridian Health expansion lead',
          body: 'Meridian Health operates three clinics across Ontario and has a budget of 6500.',
          from: 'ops@meridianhealth.example',
          to: 'sales@magiccrm.example',
        },
        schemaRevision: 6,
        contentHash: 'e'.repeat(64),
        idempotencyKey: 'idempotency-clinic',
        createdAt: at,
      },
    ],
  };
}

export function buildIngestResponse(): IngestEmailResponse {
  return {
    ingestion: {
      id: 'c0000000-0000-4000-8000-000000000001',
      workspaceId: 'demo',
      idempotencyKey: 'idempotency-clinic',
      status: 'completed',
      input: {},
      createdAt: at,
      updatedAt: at,
    },
    schemaDelta: {
      table: {
        id: demoIds.leadsTableId,
        workspaceId: 'demo',
        name: 'leads',
        description: 'Inbound sales leads',
        aliases: ['prospect', 'opportunity'],
        createdAt: at,
      },
      tableCreated: true,
      newColumns: [
        {
          id: demoIds.locationsColumnId,
          workspaceId: 'demo',
          tableId: demoIds.leadsTableId,
          name: 'locations_count',
          type: 'integer',
          aliases: ['clinics_count', 'clinics'],
          createdAt: at,
        },
        {
          id: demoIds.budgetColumnId,
          workspaceId: 'demo',
          tableId: demoIds.leadsTableId,
          name: 'budget',
          type: 'integer',
          aliases: ['budget'],
          createdAt: at,
        },
      ],
      mergedColumns: [],
      schemaRevision: 6,
    },
    record: buildLeadRecords().records[2]!,
  };
}

export function buildQueryResponse(): QueryResponse {
  return {
    query: {
      workspaceId: 'demo',
      tableId: demoIds.leadsTableId,
      filter: {
        kind: 'comparison',
        columnId: demoIds.budgetColumnId,
        operator: 'gt',
        value: 5000,
      },
      orderBy: { columnId: demoIds.budgetColumnId, direction: 'desc' },
    },
    interpretation:
      'Records in the "leads" table whose budget column value is greater than 5000, highest budget first.',
    warnings: [],
    records: [buildLeadRecords().records[2]!],
  };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export type FetchMock = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/**
 * Installs a fetch double that answers every `/api/v1` route with the fake
 * model fixtures above. Tests never touch the network.
 */
export function installFakeApi(
  overrides: Record<string, (url: string) => Response> = {},
): FetchMock {
  const mock: FetchMock = (input) => {
    const url = String(input);
    const override = Object.entries(overrides).find(([fragment]) => url.includes(fragment));
    if (override) {
      return Promise.resolve(override[1](url));
    }
    if (url.endsWith('/health')) {
      return Promise.resolve(jsonResponse(200, buildHealth()));
    }
    if (url.includes('/schema/events')) {
      return Promise.resolve(jsonResponse(200, buildSchemaEvents()));
    }
    if (url.endsWith('/schema')) {
      return Promise.resolve(jsonResponse(200, buildSchemaCatalog()));
    }
    if (url.includes('/records')) {
      return Promise.resolve(jsonResponse(200, buildLeadRecords()));
    }
    if (url.includes('/ingestions')) {
      return Promise.resolve(jsonResponse(201, buildIngestResponse()));
    }
    if (url.includes('/query')) {
      return Promise.resolve(jsonResponse(200, buildQueryResponse()));
    }
    return Promise.resolve(jsonResponse(404, { message: `No fake for ${url}` }));
  };
  vi.stubGlobal('fetch', vi.fn(mock));
  return mock;
}
