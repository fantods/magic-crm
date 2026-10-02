import { z } from 'zod';
/**
 * Normalizes strict-mode structured output before it reaches domain code.
 *
 * OpenAI strict mode forces the model to emit every key in `required`, so
 * optional contract fields arrive as explicit `null`. The Zod contracts in
 * `@formless/core` treat those fields as `optional` (absent), not nullable.
 * This function drops `null` values at positions the target schema treats as
 * optional-but-not-nullable, and leaves legitimate nullable or `unknown`
 * positions (for example the `value` field) untouched.
 *
 * The target schema is introspected rather than duplicated, so the normalizer
 * cannot drift from the domain contracts. Normalization is best effort: the
 * authoritative Zod parse happens immediately afterwards.
 */
export function normalizeModelOutput(schema: z.core.$ZodType, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (schema instanceof z.ZodOptional || schema instanceof z.ZodDefault) {
    return normalizeModelOutput(schema._zod.def.innerType, value);
  }
  if (schema instanceof z.ZodNullable) {
    return normalizeModelOutput(schema._zod.def.innerType, value);
  }

  if (schema instanceof z.ZodObject) {
    if (typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }
    const shape = schema.shape;
    const result: Record<string, unknown> = {};
    for (const [key, propertyValue] of Object.entries(value)) {
      const propertySchema = shape[key];
      if (propertySchema === undefined) {
        // Unknown keys are stripped by the subsequent Zod parse; copy through.
        result[key] = propertyValue;
        continue;
      }
      if (propertyValue === null && !acceptsNull(propertySchema)) {
        continue; // Drop null at an optional-but-not-nullable position.
      }
      result[key] = normalizeModelOutput(propertySchema, propertyValue);
    }
    return result;
  }

  if (schema instanceof z.ZodArray && Array.isArray(value)) {
    const element = schema.element;
    return value.map((entry) => normalizeModelOutput(element, entry));
  }

  if (schema instanceof z.ZodUnion) {
    return normalizeUnion(schema, value);
  }

  return value;
}

function normalizeUnion(schema: z.ZodUnion<readonly z.core.$ZodType[]>, value: unknown): unknown {
  const options = schema._zod.def.options;
  for (const option of options) {
    const normalized = normalizeModelOutput(option, value);
    // Union options are classic Zod types at runtime; the def only carries the
    // core interface, so assert the richer type for safeParse.
    const result = (option as z.ZodType).safeParse(normalized);
    if (result.success) {
      return normalized;
    }
  }
  // No variant matched: return the value untouched so the authoritative parse
  // produces the real validation error.
  return value;
}

function acceptsNull(schema: z.core.$ZodType): boolean {
  let current: z.core.$ZodType = schema;
  while (true) {
    if (current instanceof z.ZodNullable) {
      return true;
    }
    if (current instanceof z.ZodUnknown || current instanceof z.ZodAny) {
      return true; // Any value, including null, is acceptable at unknown positions.
    }
    if (current instanceof z.ZodOptional || current instanceof z.ZodDefault) {
      current = current._zod.def.innerType;
      continue;
    }
    if (current instanceof z.ZodUnion) {
      return current._zod.def.options.some(
        (option) => option instanceof z.ZodType && acceptsNull(option),
      );
    }
    return false;
  }
}
