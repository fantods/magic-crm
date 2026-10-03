/**
 * Demo scripts wired to the example buttons (PLAN.md, "Demo examples"):
 * three industry emails whose site counts fold into one `locations_count`
 * column with the values 3, 6, and 18, plus a support ticket that creates a
 * distinct logical table. The question matches the plan's acceptance query.
 */

export interface DemoEmailScript {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly email: {
    readonly subject: string;
    readonly body: string;
    readonly from: string;
    readonly to: string;
  };
}

export const demoEmailScripts: readonly DemoEmailScript[] = [
  {
    id: 'clinic-lead',
    label: 'Clinic lead',
    description: '“three clinics” becomes locations_count 3',
    email: {
      subject: 'Meridian Health expansion lead',
      body: 'Meridian Health operates three clinics across Ontario and has a budget of 6500.',
      from: 'ops@meridianhealth.example',
      to: 'sales@magiccrm.example',
    },
  },
  {
    id: 'depot-lead',
    label: 'Depot lead',
    description: '“six depots” merges into locations_count 6',
    email: {
      subject: 'Northgate Logistics site enquiry',
      body: 'Northgate Logistics runs six depots and needs a multi-site rollout.',
      from: 'finance@northgatelogistics.example',
      to: 'sales@magiccrm.example',
    },
  },
  {
    id: 'distribution-lead',
    label: 'Distribution centres',
    description: '“eighteen distribution centres” merges into locations_count 18',
    email: {
      subject: 'Cavendish Retail network',
      body: 'Cavendish Retail owns eighteen distribution centres and wants a phased deployment.',
      from: 'it@cavendishretail.example',
      to: 'sales@magiccrm.example',
    },
  },
  {
    id: 'support-ticket',
    label: 'Support ticket',
    description: 'creates a distinct support_tickets table',
    email: {
      subject: 'Cannot export campaign report',
      body: 'The campaign report export fails with error CRM-8842. This blocks our weekly review.',
      from: 'support@cavendishretail.example',
      to: 'help@magiccrm.example',
    },
  },
];

/** The acceptance-criteria question from the plan's demo examples. */
export const demoBudgetQuestion = 'Which leads have a budget over 5000?';
