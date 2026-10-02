import { describe, expect, it } from 'vitest';
import { canonicalColumnName, canonicalTableName, mergeAliases } from './naming.js';

describe('naming', () => {
  it('maps industry-specific location wording to locations_count', () => {
    expect(canonicalColumnName('clinics_count')).toBe('locations_count');
    expect(canonicalColumnName('number of depots')).toBe('locations_count');
    expect(canonicalColumnName('Distribution Centres Count')).toBe('locations_count');
  });

  it('maps semantically equivalent record types', () => {
    expect(canonicalTableName('Lead')).toBe('leads');
    expect(canonicalTableName('support request')).toBe('support_tickets');
  });

  it('deduplicates and normalizes aliases', () => {
    expect(mergeAliases(['Clinics'], undefined, ['clinics', 'depots'])).toEqual([
      'clinics',
      'depots',
    ]);
  });
});
