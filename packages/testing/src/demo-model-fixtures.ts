import type { ArchitectProposal, ReviewerDecision } from '@formless/core';
import {
  clinicLeadEmail,
  depotLeadEmail,
  distributionCentreLeadEmail,
  supportTicketEmail,
} from './demo-emails.js';

export const DEMO_LEADS_TABLE_ID = '00000000-0000-4000-8000-000000000001';
export const DEMO_LOCATIONS_COLUMN_ID = '00000000-0000-4000-8000-000000000002';
export const DEMO_BUDGET_COLUMN_ID = '00000000-0000-4000-8000-000000000003';
export const DEMO_SUPPORT_TABLE_ID = '00000000-0000-4000-8000-000000000004';
export const DEMO_ERROR_CODE_COLUMN_ID = '00000000-0000-4000-8000-000000000005';
export const DEMO_BLOCKED_COLUMN_ID = '00000000-0000-4000-8000-000000000006';

export const demoArchitectFixtures: Record<string, ArchitectProposal> = {
  [clinicLeadEmail.body]: {
    table: {
      kind: 'new',
      name: 'Lead',
      description: 'Inbound sales lead',
      aliases: ['prospect'],
    },
    fields: [
      {
        key: 'clinic_count',
        columnName: 'clinics_count',
        type: 'integer',
        value: 3,
        evidence: { source: 'body', text: 'three clinics' },
        rationale: 'The sender states the number of operated clinics.',
      },
      {
        key: 'budget',
        columnName: 'budget',
        type: 'integer',
        value: 6500,
        evidence: { source: 'body', text: 'budget of 6500' },
        rationale: 'The stated budget is a durable sales fact.',
      },
    ],
  },
  [depotLeadEmail.body]: {
    table: {
      kind: 'existing',
      tableId: DEMO_LEADS_TABLE_ID,
    },
    fields: [
      {
        key: 'depot_count',
        columnName: 'depots_count',
        type: 'integer',
        value: 6,
        evidence: { source: 'body', text: 'six depots' },
        rationale: 'The sender states the number of depots.',
      },
    ],
  },
  [distributionCentreLeadEmail.body]: {
    table: {
      kind: 'existing',
      tableId: DEMO_LEADS_TABLE_ID,
    },
    fields: [
      {
        key: 'distribution_centre_count',
        columnName: 'distribution_centres_count',
        type: 'integer',
        value: 18,
        evidence: { source: 'body', text: 'eighteen distribution centres' },
        rationale: 'The sender states the size of the distribution network.',
      },
    ],
  },
  [supportTicketEmail.body]: {
    table: {
      kind: 'new',
      name: 'Support ticket',
      description: 'Inbound customer support ticket',
      aliases: ['support request'],
    },
    fields: [
      {
        key: 'error_code',
        columnName: 'error_code',
        type: 'text',
        value: 'CRM-8842',
        evidence: { source: 'body', text: 'error CRM-8842' },
        rationale: 'The error code is useful for support triage.',
      },
      {
        key: 'blocked',
        columnName: 'blocks_weekly_review',
        type: 'boolean',
        value: true,
        evidence: { source: 'body', text: 'blocks our weekly review' },
        rationale: 'The business impact is explicit.',
      },
    ],
  },
};

export const demoReviewerFixtures: Record<string, ReviewerDecision> = {
  [clinicLeadEmail.body]: {
    table: {
      action: 'accept_new',
      name: 'leads',
      description: 'Inbound sales leads',
      aliases: ['prospect', 'opportunity'],
      rationale: 'The email is a distinct sales lead, not a support request.',
    },
    fields: [
      {
        action: 'accept_new',
        fieldKey: 'clinic_count',
        columnName: 'locations_count',
        type: 'integer',
        rationale: 'Clinic count is a repeatable site count concept; use a generic column name.',
      },
      {
        action: 'accept_new',
        fieldKey: 'budget',
        columnName: 'budget',
        type: 'integer',
        rationale: 'Budget is durable and useful for lead qualification.',
      },
    ],
  },
  [depotLeadEmail.body]: {
    table: {
      action: 'use_existing',
      tableId: DEMO_LEADS_TABLE_ID,
      rationale: 'This is another inbound sales lead.',
    },
    fields: [
      {
        action: 'map_existing',
        fieldKey: 'depot_count',
        existingColumnId: DEMO_LOCATIONS_COLUMN_ID,
        rationale: 'Depots are locations and belong in locations_count.',
      },
    ],
  },
  [distributionCentreLeadEmail.body]: {
    table: {
      action: 'use_existing',
      tableId: DEMO_LEADS_TABLE_ID,
      rationale: 'This is another inbound sales lead.',
    },
    fields: [
      {
        action: 'map_existing',
        fieldKey: 'distribution_centre_count',
        existingColumnId: DEMO_LOCATIONS_COLUMN_ID,
        rationale: 'Distribution centres are locations and belong in locations_count.',
      },
    ],
  },
  [supportTicketEmail.body]: {
    table: {
      action: 'accept_new',
      name: 'support_tickets',
      description: 'Inbound customer support tickets',
      aliases: ['support requests'],
      rationale: 'A support ticket is a different kind of record from a lead.',
    },
    fields: [
      {
        action: 'accept_new',
        fieldKey: 'error_code',
        columnName: 'error_code',
        type: 'text',
        rationale: 'Error codes are durable support facts.',
      },
      {
        action: 'accept_new',
        fieldKey: 'blocked',
        columnName: 'blocks_weekly_review',
        type: 'boolean',
        rationale: 'Business impact is useful for prioritization.',
      },
    ],
  },
};
