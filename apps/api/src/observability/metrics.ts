import client from '@prometheus-io/client';
import type { FastifyInstance, FastifyPluginCallback } from 'fastify';
import fastifyMetricsModule, { type IMetricsPluginOptions } from 'fastify-metrics';

/**
 * Scrape path for the API's Prometheus metrics. It lives under the versioned
 * `/api/v1` prefix so it is reachable through the same Ingress and nginx
 * `/api/` proxy as every other endpoint; Prometheus scrapes the api Service
 * directly (see `infra/k8s/base/monitoring/`).
 */
export const METRICS_PATH = '/api/v1/metrics';

// fastify-metrics ships a CJS build without an `exports` map, so under
// NodeNext TypeScript models its `export default` as the module namespace,
// which is not callable. At runtime the ESM default import is the registered
// plugin function (its `exports.default`), so align the static type with the
// actual runtime shape instead of registering a namespace.
const metricsPlugin = fastifyMetricsModule as unknown as FastifyPluginCallback<
  Partial<IMetricsPluginOptions>
>;

/**
 * Registers the Prometheus metrics plugin with its own isolated registry.
 *
 * - HTTP request metrics: `http_request_duration_seconds` (histogram) and
 *   `http_request_summary_seconds` (summary), labeled `method`, `route`
 *   (route template such as `/api/v1/workspaces/:workspaceId/ingestions` —
 *   never a raw URL), and `status_code`.
 * - Process metrics: Node.js vitals (CPU, memory, event loop lag, GC, file
 *   descriptors) from the Prometheus client's default collectors.
 *
 * Each app instance gets a fresh `Registry` (the plugin otherwise writes to
 * a module-global register, which collides when tests build many apps in one
 * process). The plugin's `promClient` option injects this package's client
 * copy, keeping registry and metric classes from one module instance.
 *
 * Privacy: metrics carry only route templates, methods, and status codes.
 * Query strings, request bodies, and email content never enter a label or
 * value, mirroring the logging decision in `observability/logger.ts`.
 */
export async function registerMetrics(app: FastifyInstance): Promise<void> {
  const registry = new client.Registry();
  await app.register(metricsPlugin, {
    // Use this package's client everywhere so the custom registry is an
    // instance of the Registry class the plugin merges and serves from.
    promClient: client,
    // The string form registers `GET <path>` silently (log level `fatal`,
    // no HEAD route). The plugin adds the handler itself.
    endpoint: METRICS_PATH,
    // `enabled: true` is required here: the plugin's shallow option merge
    // would otherwise leave it undefined and skip default-metrics collection.
    defaultMetrics: { enabled: true, register: registry },
    routeMetrics: {
      overrides: {
        histogram: { registers: [registry] },
        summary: { registers: [registry] },
      },
    },
  });
}
