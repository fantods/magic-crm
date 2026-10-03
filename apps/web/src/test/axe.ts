import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/**
 * Minimal axe-core harness for the vitest jsdom environment.
 *
 * axe-core ships a browser bundle; evaluating it inside the jsdom window
 * gives us the real rule engine without any extra matcher dependency. Rules
 * that need layout (color contrast) self-report as "incomplete" in jsdom and
 * are therefore excluded here; the structural rules — landmarks, labels,
 * names, roles, ARIA usage — all run for real.
 */

export interface AxeNode {
  readonly target: readonly string[];
}

export interface AxeViolation {
  readonly id: string;
  readonly impact: string | null;
  readonly description: string;
  readonly help: string;
  readonly nodes: readonly AxeNode[];
}

export interface AxeResults {
  readonly violations: readonly AxeViolation[];
  readonly incomplete: readonly unknown[];
}

interface AxeWindow {
  axe: {
    run(
      context?: Element | Document,
      options?: Record<string, unknown>,
    ): Promise<{
      violations: AxeViolation[];
      incomplete: AxeViolation[];
    }>;
  };
}

let axeInstalled = false;

function installAxe(): void {
  if (axeInstalled) {
    return;
  }
  const require = createRequire(import.meta.url);
  const axeSource = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
  window.eval(axeSource);
  axeInstalled = true;
}

/**
 * Runs axe against the given context (default: the whole document) and
 * returns only the violations that a jsdom run can evaluate with certainty.
 */
export async function runAxe(context: Element | Document = document): Promise<AxeResults> {
  installAxe();
  const axe = (window as unknown as AxeWindow).axe;
  const result = await axe.run(context, {
    resultTypes: ['violations'],
  });
  return {
    violations: result.violations,
    incomplete: result.incomplete,
  };
}

/** Formats violations into an assertion-friendly message. */
export function describeViolations(results: AxeResults): string {
  return results.violations
    .map(
      (violation) =>
        `${violation.id} (${violation.impact ?? 'unknown impact'}): ${violation.help} — targets: ${violation.nodes
          .map((node) => node.target.join(' '))
          .join(', ')}`,
    )
    .join('\n');
}
