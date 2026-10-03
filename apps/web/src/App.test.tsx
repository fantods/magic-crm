import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { installFakeApi, type FetchMock } from './test/fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

async function renderDemoApp(overrides?: Record<string, (url: string) => Response>) {
  const fetchMock: FetchMock = installFakeApi(overrides);
  const user = userEvent.setup();
  render(<App />);
  return { user, fetchMock };
}

describe('Demo web app (fake model pattern, no network)', () => {
  it('runs the demo flow: example email, ingestion, schema, records, evidence, journal', async () => {
    const { user } = await renderDemoApp();

    // Schema catalogue and journal load for the demo workspace.
    expect(await screen.findByText('revision 8')).toBeInTheDocument();
    expect(screen.getByText('locations_count')).toBeInTheDocument();
    expect(screen.getAllByText('support_tickets').length).toBeGreaterThan(0);

    // Journal shows the architect proposal and the reviewer merge decision.
    expect(screen.getByText('Architect proposed a new table “Lead”')).toBeInTheDocument();
    expect(screen.getByText(/merged “depots_count” into an existing column/i)).toBeInTheDocument();

    // Example button fills the paste area, then the email is ingested.
    await user.click(screen.getByRole('button', { name: 'Clinic lead' }));
    const body = screen.getByLabelText('Email body') as HTMLTextAreaElement;
    expect(body.value).toContain('three clinics');
    await user.click(screen.getByRole('button', { name: 'Ingest email' }));

    // The ingestion summary reports the created table and new columns.
    const summary = await screen.findByTestId('ingest-summary');
    expect(summary).toHaveTextContent('Created table');
    expect(summary).toHaveTextContent('locations_count');

    // The records grid shows the canonical value with the schema column.
    const grid = await screen.findByRole('table', { name: 'Records in leads' });
    expect(within(grid).getByText('3')).toBeInTheDocument();
    expect(within(grid).getByText('6500')).toBeInTheDocument();

    // Evidence inspection reveals the exact source phrase.
    await user.click(within(grid).getAllByText('Evidence')[0]!);
    expect(await screen.findByText('“three clinics”')).toBeInTheDocument();
  }, 20_000);

  it('answers the example natural-language question with the interpreted query', async () => {
    const { user } = await renderDemoApp();

    await user.click(
      await screen.findByRole('button', { name: /Try: Which leads have a budget over 5000\?/ }),
    );

    const result = await screen.findByTestId('query-result');
    expect(result).toHaveTextContent('Interpreted as:');
    expect(result).toHaveTextContent('budget > 5000');
    expect(result).toHaveTextContent('1 record');
  });

  it('surfaces the server key requirement when the API answers 503', async () => {
    const { user } = await renderDemoApp({
      '/ingestions': () =>
        new Response(
          JSON.stringify({
            statusCode: 503,
            error: 'Service Unavailable',
            message: 'Ingestion is unavailable: OPENAI_API_KEY is not configured on the server.',
          }),
          { status: 503, headers: { 'content-type': 'application/json' } },
        ),
    });

    await screen.findByText('revision 8');
    await user.click(screen.getByRole('button', { name: 'Clinic lead' }));
    await user.click(screen.getByRole('button', { name: 'Ingest email' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('OPENAI_API_KEY is not configured on the server.');
    expect(alert).toHaveTextContent('the key never reaches this browser');
  });

  it('marks the API as unreachable when the server is down', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('Failed to fetch'))),
    );
    render(<App />);

    expect(await screen.findByText('API unreachable')).toBeInTheDocument();
  });
});
