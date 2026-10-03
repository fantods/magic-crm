import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App.js';
import { describeViolations, runAxe } from './test/axe.js';
import { installFakeApi } from './test/fixtures.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Accessibility audit (axe-core)', () => {
  it('renders the full demo page with no automatically detectable violations', async () => {
    // Mirror the shipped index.html, which declares the page language and
    // title; the jsdom test document does not inherit either.
    document.documentElement.lang = 'en';
    document.title = 'Magic CRM';

    installFakeApi();
    render(<App />);

    // The five panels render fully before auditing: wait for data from every
    // fake endpoint (schema, journal, records) to be on screen.
    expect(await screen.findByText('revision 8')).toBeInTheDocument();
    expect(screen.getByText('locations_count')).toBeInTheDocument();
    expect(screen.getAllByText('support_tickets').length).toBeGreaterThan(0);

    const results = await runAxe(document);
    expect(results.violations, describeViolations(results)).toHaveLength(0);
  });
});
