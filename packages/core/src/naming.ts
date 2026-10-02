const locationWords =
  /(?:locations?|sites?|clinics?|depots?|distribution[_ ]cent(?:er|re)s?|branches?)/;

export function normalizeIdentifier(value: string): string {
  return value
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_{2,}/g, '_');
}

export function canonicalColumnName(value: string): string {
  const normalized = normalizeIdentifier(value);
  const looksLikeLocationCount =
    (locationWords.test(normalized) && /(?:count|number|no|total|how_many)/.test(normalized)) ||
    /^(?:clinics?|depots?|sites?|locations?|distribution_centers?|distribution_centres?)_count$/.test(
      normalized,
    ) ||
    /^(?:number|no)_of_(?:clinics?|depots?|sites?|locations?|distribution_centers?|distribution_centres?)$/.test(
      normalized,
    );

  return looksLikeLocationCount ? 'locations_count' : normalized;
}

export function canonicalTableName(value: string): string {
  const normalized = normalizeIdentifier(value);

  if (/support_ticket|support_request|customer_ticket|incident$/.test(normalized)) {
    return 'support_tickets';
  }

  if (/lead|prospect|opportunity/.test(normalized)) {
    return 'leads';
  }

  if (/s$/.test(normalized)) {
    return normalized;
  }

  if (/(?:ch|sh|ss|x|s)$/.test(normalized)) {
    return `${normalized}es`;
  }

  return `${normalized}s`;
}

export function mergeAliases(...aliasGroups: readonly (readonly string[] | undefined)[]): string[] {
  const result = new Set<string>();

  for (const group of aliasGroups) {
    for (const alias of group ?? []) {
      const normalized = normalizeIdentifier(alias);
      if (normalized.length > 0) {
        result.add(normalized);
      }
    }
  }

  return [...result];
}
