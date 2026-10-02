import type { EmailIngestionInput } from '@formless/contracts';

export const clinicLeadEmail: EmailIngestionInput = {
  workspaceId: 'demo',
  subject: 'Meridian Health expansion lead',
  body: 'Meridian Health operates three clinics across Ontario and has a budget of 6500.',
  from: 'ops@meridianhealth.example',
  to: 'sales@magiccrm.example',
};

export const depotLeadEmail: EmailIngestionInput = {
  workspaceId: 'demo',
  subject: 'Northgate Logistics site enquiry',
  body: 'Northgate Logistics runs six depots and needs a multi-site rollout.',
  from: 'finance@northgatelogistics.example',
  to: 'sales@magiccrm.example',
};

export const distributionCentreLeadEmail: EmailIngestionInput = {
  workspaceId: 'demo',
  subject: 'Cavendish Retail network',
  body: 'Cavendish Retail owns eighteen distribution centres and wants a phased deployment.',
  from: 'it@cavendishretail.example',
  to: 'sales@magiccrm.example',
};

export const supportTicketEmail: EmailIngestionInput = {
  workspaceId: 'demo',
  subject: 'Cannot export campaign report',
  body: 'The campaign report export fails with error CRM-8842. This blocks our weekly review.',
  from: 'support@cavendishretail.example',
  to: 'help@magiccrm.example',
};
