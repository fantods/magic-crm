import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import type { IngestEmailResponse, QueryResponse } from '@formless/contracts';
import {
  useHealth,
  useIngestEmail,
  useRecords,
  useRunQuery,
  useSchemaCatalog,
  useSchemaEvents,
  DEMO_WORKSPACE_ID,
} from './api/hooks.js';
import type { IngestEmailRequest } from './api/client.js';
import { demoBudgetQuestion } from './demo/demo-scripts.js';
import { EmailPanel } from './components/EmailPanel.js';
import { JournalPanel } from './components/JournalPanel.js';
import { QueryPanel } from './components/QueryPanel.js';
import { RecordsPanel } from './components/RecordsPanel.js';
import { SchemaPanel } from './components/SchemaPanel.js';

export function App() {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, refetchOnWindowFocus: false, staleTime: 5_000 },
          mutations: { retry: false },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <DemoWorkspace />
    </QueryClientProvider>
  );
}

function DemoWorkspace() {
  const health = useHealth();
  const catalog = useSchemaCatalog(DEMO_WORKSPACE_ID);
  const events = useSchemaEvents(DEMO_WORKSPACE_ID);
  const [selectedTableId, setSelectedTableId] = useState<string | undefined>(undefined);
  const [lastIngest, setLastIngest] = useState<IngestEmailResponse | null>(null);
  const [lastQuery, setLastQuery] = useState<QueryResponse | null>(null);
  const ingest = useIngestEmail(DEMO_WORKSPACE_ID);
  const ask = useRunQuery(DEMO_WORKSPACE_ID);

  const tables = catalog.data?.tables ?? [];
  const effectiveTableId = selectedTableId ?? tables[0]?.table.id;
  const records = useRecords(DEMO_WORKSPACE_ID, effectiveTableId);

  function handleIngest(input: IngestEmailRequest) {
    ingest.mutate(input, {
      onSuccess: (response) => {
        setLastIngest(response);
        setSelectedTableId(response.schemaDelta.table.id);
      },
    });
  }

  function handleAsk(question: string) {
    ask.mutate({ question }, { onSuccess: (response) => setLastQuery(response) });
  }

  const columnNames = new Map<string, string>();
  for (const { columns } of tables) {
    for (const column of columns) {
      columnNames.set(column.id, column.name);
    }
  }
  const tableNames = new Map(tables.map(({ table }) => [table.id, table.name]));

  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">Magic CRM · demo workspace “{DEMO_WORKSPACE_ID}”</p>
          <h1>A CRM that designs its own schema</h1>
          <p className="tagline">
            Paste an email: it becomes a logical table, a record with preserved source evidence, and
            an answerable dataset.
          </p>
        </div>
        <div
          className={`api-status ${health.isError ? 'api-status-down' : health.data ? 'api-status-up' : 'api-status-pending'}`}
          role="status"
          aria-label="API status"
        >
          {health.isError
            ? 'API unreachable'
            : health.data
              ? `API ${health.data.service} v${health.data.version}`
              : 'Connecting…'}
        </div>
      </header>

      <div className="demo-grid">
        <EmailPanel
          pending={ingest.isPending}
          lastResult={lastIngest}
          error={ingest.error}
          onSubmit={handleIngest}
        />
        <SchemaPanel catalog={catalog.data} isLoading={catalog.isLoading} error={catalog.error} />
        <RecordsPanel
          tables={tables}
          selectedTableId={effectiveTableId}
          onSelectTable={setSelectedTableId}
          records={records.data?.records}
          isLoading={records.isLoading}
          error={records.error}
        />
        <JournalPanel
          events={events.data?.events}
          total={events.data?.total}
          isLoading={events.isLoading}
          error={events.error}
        />
        <QueryPanel
          pending={ask.isPending}
          result={lastQuery}
          error={ask.error}
          exampleQuestion={demoBudgetQuestion}
          onAsk={handleAsk}
          resolveTableName={(tableId) => tableNames.get(tableId) ?? tableId.slice(0, 8)}
          resolveColumnName={(columnId) => columnNames.get(columnId) ?? columnId.slice(0, 8)}
        />
      </div>
    </main>
  );
}
