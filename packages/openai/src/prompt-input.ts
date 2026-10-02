import type { NormalizedEmail, SchemaSnapshot } from '@formless/core';

/**
 * Shared serialization of prompt inputs. Email content appears only in the
 * JSON user payload sent to OpenAI; it is never logged.
 */

export function serializeEmailForPrompt(email: NormalizedEmail) {
  return {
    ...(email.subject === undefined ? {} : { subject: email.subject }),
    ...(email.from === undefined ? {} : { from: email.from }),
    ...(email.to === undefined ? {} : { to: email.to }),
    ...(email.receivedAt === undefined ? {} : { receivedAt: email.receivedAt }),
    body: email.body,
  };
}

export function serializeSchemaForPrompt(schema: SchemaSnapshot) {
  return {
    tables: schema.tables.map((table) => ({
      id: table.id,
      name: table.name,
      ...(table.aliases.length === 0 ? {} : { aliases: table.aliases }),
      columns: table.columns.map((column) => ({
        id: column.id,
        name: column.name,
        type: column.type,
        ...(column.aliases.length === 0 ? {} : { aliases: column.aliases }),
        ...(column.unit === undefined ? {} : { unit: column.unit }),
        ...(column.enumValues === undefined ? {} : { enumValues: column.enumValues }),
      })),
    })),
  };
}
