import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchHealth,
  fetchRecords,
  fetchSchemaCatalog,
  fetchSchemaEvents,
  ingestEmail,
  runQuery,
  type IngestEmailRequest,
} from './client.js';
import type {
  IngestEmailResponse,
  NaturalLanguageQueryInput,
  QueryResponse,
} from '@formless/contracts';

/** The single demo workspace used by the v1 demo UI. */
export const DEMO_WORKSPACE_ID = 'demo';

export const queryKeys = {
  health: ['health'] as const,
  schema: (workspaceId: string) => ['schema', workspaceId] as const,
  events: (workspaceId: string) => ['events', workspaceId] as const,
  records: (workspaceId: string, tableId: string) => ['records', workspaceId, tableId] as const,
};

export function useHealth() {
  return useQuery({ queryKey: queryKeys.health, queryFn: fetchHealth });
}

export function useSchemaCatalog(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.schema(workspaceId),
    queryFn: () => fetchSchemaCatalog(workspaceId),
  });
}

export function useSchemaEvents(workspaceId: string) {
  return useQuery({
    queryKey: queryKeys.events(workspaceId),
    queryFn: () => fetchSchemaEvents(workspaceId),
  });
}

export function useRecords(workspaceId: string, tableId: string | undefined) {
  return useQuery({
    queryKey: queryKeys.records(workspaceId, tableId ?? ''),
    queryFn: () => fetchRecords(workspaceId, tableId as string),
    enabled: tableId !== undefined,
  });
}

export function useIngestEmail(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: IngestEmailRequest): Promise<IngestEmailResponse> =>
      ingestEmail(workspaceId, input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['schema', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['events', workspaceId] });
      void queryClient.invalidateQueries({ queryKey: ['records', workspaceId] });
    },
  });
}

export function useRunQuery(workspaceId: string) {
  return useMutation({
    mutationFn: (input: NaturalLanguageQueryInput): Promise<QueryResponse> =>
      runQuery(workspaceId, input),
  });
}
