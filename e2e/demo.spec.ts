import { expect, test } from '@playwright/test';

/**
 * Playwright end-to-end demo walkthrough (PLAN.md, "Demo examples").
 *
 * The three plan cases run in order against one freshly reset e2e database
 * and the deterministic fake model server, so no OpenAI key is needed:
 *
 * 1. three industry emails fold into one `locations_count` column (3, 6, 18),
 * 2. a support ticket creates a distinct logical table,
 * 3. the query "Which leads have a budget over 5000?" answers correctly.
 *
 * The tests are serial because they share the demo workspace's evolving
 * schema on purpose — later cases build on earlier ingested state.
 */
test.describe.configure({ mode: 'serial' });

const demoWorkspaceLabel = 'demo workspace “demo”';

async function ingestExample(page: import('@playwright/test').Page, buttonLabel: string) {
  await page.getByRole('button', { name: buttonLabel }).click();
  await expect(page.getByRole('textbox', { name: 'Email body' })).toHaveValue(/./);
  await page.getByRole('button', { name: 'Ingest email' }).click();
  await expect(page.getByTestId('ingest-summary')).toBeVisible();
}

test(`the three industry leads fold into one locations_count column with values 3, 6, and 18`, async ({
  page,
}) => {
  await page.goto('/');

  // The demo shell loaded and reached the fake-model API.
  await expect(
    page.getByRole('heading', { name: 'A CRM that designs its own schema' }),
  ).toBeVisible();
  await expect(page.getByText(demoWorkspaceLabel)).toBeVisible();

  await ingestExample(page, 'Clinic lead');
  await expect(page.getByTestId('ingest-summary')).toContainText('Created table');
  await expect(page.getByTestId('ingest-summary')).toContainText('2 new columns');

  await ingestExample(page, 'Depot lead');
  await expect(page.getByTestId('ingest-summary')).toContainText('merged');

  await ingestExample(page, 'Distribution centres');
  await expect(page.getByTestId('ingest-summary')).toContainText('merged');

  // One `locations_count` column, not one per synonym: exactly one schema
  // column cell is named locations_count (alias mentions don't count).
  const schemaPanel = page.locator('section.panel-schema');
  await expect(schemaPanel.getByRole('cell').filter({ hasText: /^locations_count$/ })).toHaveCount(
    1,
  );

  // The leads record grid shows the canonical values 3, 6, and 18.
  const recordsPanel = page.locator('section.panel-records');
  await expect(recordsPanel.locator('table tbody tr')).toHaveCount(3);
  for (const value of ['3', '6', '18']) {
    await expect(recordsPanel.getByRole('cell', { name: value, exact: true })).toHaveCount(1);
  }

  // The evidence for the folded values stays inspectable.
  const evidence = recordsPanel.getByRole('cell', { name: '18', exact: true }).locator('..');
  await evidence.getByText('Evidence').click();
  await expect(recordsPanel.getByText('“eighteen distribution centres”')).toBeVisible();
});

test(`a support ticket creates a distinct logical table`, async ({ page }) => {
  await page.goto('/');

  await ingestExample(page, 'Support ticket');
  const summary = page.getByTestId('ingest-summary');
  await expect(summary).toContainText('Created table');
  await expect(summary).toContainText('support_tickets');

  // The schema catalogue lists the separate support_tickets table.
  const schemaPanel = page.locator('section.panel-schema');
  await expect(schemaPanel.getByText('support_tickets')).toBeVisible();
  await expect(schemaPanel.getByRole('cell').filter({ hasText: /^error_code$/ })).toHaveCount(1);

  // Its records live in their own table, separate from leads.
  await page.getByRole('combobox', { name: 'Table' }).selectOption({ label: 'support_tickets' });
  const recordsPanel = page.locator('section.panel-records');
  await expect(recordsPanel.getByRole('cell', { name: 'CRM-8842' })).toBeVisible();
  await expect(recordsPanel.locator('table tbody tr')).toHaveCount(1);
});

test(`the query "Which leads have a budget over 5000?" returns the correct records`, async ({
  page,
}) => {
  await page.goto('/');

  // Example chips fill the question and run it through the fake planner.
  await page.getByRole('button', { name: /Try: Which leads have a budget over 5000/ }).click();

  const result = page.getByTestId('query-result');
  await expect(result).toBeVisible();
  await expect(result).toContainText('Interpreted as:');
  await expect(result).toContainText('budget > 5000');

  // Only the clinic lead (budget 6500) clears the bar; the answer is a
  // structured query with an interpretation, not generated SQL.
  const resultTable = result.locator('table');
  await expect(resultTable.getByRole('cell', { name: '6500' })).toBeVisible();
  await expect(result.getByText('1 record')).toBeVisible();
  await expect(result.getByText('Structured query')).toBeVisible();
});
