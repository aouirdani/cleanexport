import { describe, it, expect } from 'vitest';
import { buildExportPayload, canPreview } from '@/components/exports/payload';
import { INITIAL_BUILDER_STATE, type BuilderState } from '@/components/exports/types';

// components/exports/payload.ts - the state->API-body conversion shared by
// export-builder.tsx's save and preview-panel.tsx's preview
// (specs/07-TASKS.md T18: same schema, same body-building, for both).

function state(overrides: Partial<BuilderState> = {}): BuilderState {
  return { ...INITIAL_BUILDER_STATE, ...overrides };
}

describe('buildExportPayload', () => {
  it('trims the name', () => {
    const payload = buildExportPayload(state({ name: '  My Export  ', objectType: 'DEALS', properties: ['dealname'] }));
    expect(payload.name).toBe('My Export');
  });

  it('omits filters entirely when there are none', () => {
    const payload = buildExportPayload(state({ objectType: 'DEALS', properties: ['dealname'], filters: [] }));
    expect(payload.filters).toBeUndefined();
  });

  it('converts a HAS_PROPERTY/NOT_HAS_PROPERTY condition with no value field', () => {
    const payload = buildExportPayload(
      state({
        objectType: 'DEALS',
        properties: ['dealname'],
        filters: [{ property: 'email', operator: 'HAS_PROPERTY', value: '', highValue: '', values: '' }],
      }),
    );
    expect(payload.filters).toEqual({ operator: 'AND', conditions: [{ property: 'email', operator: 'HAS_PROPERTY' }] });
  });

  it('converts a BETWEEN condition with both value and highValue', () => {
    const payload = buildExportPayload(
      state({
        objectType: 'DEALS',
        properties: ['dealname'],
        filters: [
          { property: 'createdate', operator: 'BETWEEN', value: '2026-01-01', highValue: '2026-03-31', values: '' },
        ],
      }),
    );
    expect(payload.filters?.conditions).toEqual([
      { property: 'createdate', operator: 'BETWEEN', value: '2026-01-01', highValue: '2026-03-31' },
    ]);
  });

  it('splits an IN condition\'s comma-separated raw input into a trimmed array, dropping empties', () => {
    const payload = buildExportPayload(
      state({
        objectType: 'DEALS',
        properties: ['dealname'],
        filters: [{ property: 'hs_lead_status', operator: 'IN', value: '', highValue: '', values: ' NEW, OPEN ,, ' }],
      }),
    );
    expect(payload.filters?.conditions).toEqual([{ property: 'hs_lead_status', operator: 'IN', values: ['NEW', 'OPEN'] }]);
  });

  it('converts EQ/NEQ/GT/LT with a plain value field', () => {
    const payload = buildExportPayload(
      state({
        objectType: 'DEALS',
        properties: ['dealname'],
        filters: [{ property: 'amount', operator: 'GT', value: '1000', highValue: '', values: '' }],
      }),
    );
    expect(payload.filters?.conditions).toEqual([{ property: 'amount', operator: 'GT', value: '1000' }]);
  });

  it('omits associations when there is no association or it has no columns', () => {
    expect(buildExportPayload(state({ objectType: 'DEALS', properties: ['dealname'] })).associations).toBeUndefined();
    expect(
      buildExportPayload(state({ objectType: 'DEALS', properties: ['dealname'], association: { toObjectType: 'COMPANIES', columns: [] } }))
        .associations,
    ).toBeUndefined();
  });

  it('includes associations when columns are present', () => {
    const payload = buildExportPayload(
      state({
        objectType: 'DEALS',
        properties: ['dealname'],
        association: { toObjectType: 'COMPANIES', columns: ['name', 'domain'] },
      }),
    );
    expect(payload.associations).toEqual({ toObjectType: 'COMPANIES', columns: ['name', 'domain'] });
  });

  it('splits recipients on commas AND newlines, trims, and drops empties', () => {
    const payload = buildExportPayload(
      state({ objectType: 'DEALS', properties: ['dealname'], recipients: 'a@x.com, b@x.com\nc@x.com,,  ' }),
    );
    expect(payload.recipients).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);
  });

  it('preserves property order exactly', () => {
    const payload = buildExportPayload(state({ objectType: 'DEALS', properties: ['zeta', 'alpha', 'middle'] }));
    expect(payload.properties).toEqual(['zeta', 'alpha', 'middle']);
  });
});

describe('canPreview', () => {
  it('false with no object type', () => {
    expect(canPreview(state({ name: 'x', properties: ['a'] }))).toBe(false);
  });

  it('false with no properties', () => {
    expect(canPreview(state({ name: 'x', objectType: 'DEALS', properties: [] }))).toBe(false);
  });

  it('false with a blank (whitespace-only) name', () => {
    expect(canPreview(state({ name: '   ', objectType: 'DEALS', properties: ['dealname'] }))).toBe(false);
  });

  it('true once name, object type, and at least one property are all present', () => {
    expect(canPreview(state({ name: 'x', objectType: 'DEALS', properties: ['dealname'] }))).toBe(true);
  });
});
