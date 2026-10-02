import { initialSchemaMigration } from './001-initial-schema.js';

export const migrations = [initialSchemaMigration] as const;

export type Migration = (typeof migrations)[number];
