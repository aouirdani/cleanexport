import { describe, it, expect } from 'vitest';
import { CreateExportSchema, PatchExportSchema } from '@/lib/schemas';

const BASE = {
  name: 'My Export',
  objectType: 'CONTACTS' as const,
  properties: ['firstname', 'lastname'],
};

describe('CreateExportSchema', () => {
  it('accepts a minimal valid export', () => {
    const result = CreateExportSchema.safeParse(BASE);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.headerStyle).toBe('LABEL'); // default
      expect(result.data.scheduleTz).toBe('Europe/Paris'); // default
      expect(result.data.recipients).toEqual([]); // default
    }
  });

  it('rejects an empty properties array', () => {
    expect(CreateExportSchema.safeParse({ ...BASE, properties: [] }).success).toBe(false);
  });

  it('rejects more than 200 properties', () => {
    const properties = Array.from({ length: 201 }, (_, i) => `p${i}`);
    expect(CreateExportSchema.safeParse({ ...BASE, properties }).success).toBe(false);
  });

  it('accepts exactly 200 properties', () => {
    const properties = Array.from({ length: 200 }, (_, i) => `p${i}`);
    expect(CreateExportSchema.safeParse({ ...BASE, properties }).success).toBe(true);
  });

  it('rejects duplicate properties even under the 200 cap', () => {
    const result = CreateExportSchema.safeParse({ ...BASE, properties: ['firstname', 'firstname'] });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown objectType', () => {
    expect(CreateExportSchema.safeParse({ ...BASE, objectType: 'NOTES' }).success).toBe(false);
  });

  it('accepts a valid AND filter with up to 5 conditions', () => {
    const result = CreateExportSchema.safeParse({
      ...BASE,
      filters: {
        operator: 'AND',
        conditions: [
          { property: 'createdate', operator: 'BETWEEN', value: '2026-01-01', highValue: '2026-03-31' },
          { property: 'hs_lead_status', operator: 'IN', values: ['NEW', 'OPEN'] },
          { property: 'email', operator: 'HAS_PROPERTY' },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a 6th filter condition', () => {
    const conditions = Array.from({ length: 6 }, (_, i) => ({
      property: `p${i}`,
      operator: 'HAS_PROPERTY' as const,
    }));
    expect(CreateExportSchema.safeParse({ ...BASE, filters: { operator: 'AND', conditions } }).success).toBe(false);
  });

  it('rejects BETWEEN without a highValue', () => {
    const result = CreateExportSchema.safeParse({
      ...BASE,
      filters: { operator: 'AND', conditions: [{ property: 'createdate', operator: 'BETWEEN', value: '2026-01-01' }] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects IN without any values', () => {
    const result = CreateExportSchema.safeParse({
      ...BASE,
      filters: { operator: 'AND', conditions: [{ property: 'x', operator: 'IN', values: [] }] },
    });
    expect(result.success).toBe(false);
  });

  it('accepts a valid association', () => {
    const result = CreateExportSchema.safeParse({
      ...BASE,
      objectType: 'DEALS',
      associations: { toObjectType: 'COMPANIES', columns: ['name', 'domain'] },
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.associations?.cardinality).toBe('PRIMARY'); // default
  });

  it('rejects an association whose toObjectType is the export\'s own objectType', () => {
    const result = CreateExportSchema.safeParse({
      ...BASE,
      objectType: 'DEALS',
      associations: { toObjectType: 'DEALS', columns: ['dealname'] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a malformed cron expression', () => {
    expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: 'not a cron' }).success).toBe(false);
    expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: '* * *' }).success).toBe(false);
  });

  it('accepts a well-formed 5-field cron expression', () => {
    expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: '0 9 * * 1' }).success).toBe(true);
  });

  it('accepts a null scheduleCron (manual only)', () => {
    expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: null }).success).toBe(true);
  });

  it('rejects more than 10 recipients', () => {
    const recipients = Array.from({ length: 11 }, (_, i) => `user${i}@example.com`);
    expect(CreateExportSchema.safeParse({ ...BASE, recipients }).success).toBe(false);
  });

  it('rejects a non-email recipient', () => {
    expect(CreateExportSchema.safeParse({ ...BASE, recipients: ['not-an-email'] }).success).toBe(false);
  });

  // A raw */5 * * * * schedule is a well-formed 5-field cron (passes
  // CRON_SHAPE) that fires 288 times a day - nothing previously stopped it
  // from being saved. The minimum enforced is one hour - see
  // lib/schemas.ts's MIN_SCHEDULE_INTERVAL_MINUTES for why that specific
  // number, not something coarser or finer.
  describe('sub-hourly schedules are rejected', () => {
    it('rejects a 5-minute step ("*/5 * * * *") - the exact incident this closes', () => {
      const result = CreateExportSchema.safeParse({ ...BASE, scheduleCron: '*/5 * * * *' });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.map((i) => i.message).join(' ')).toMatch(/once per hour/);
      }
    });

    it('rejects a wildcard minute field ("* * * * *") - fires every single minute', () => {
      expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: '* * * * *' }).success).toBe(false);
    });

    it('rejects a comma list in the minute field ("0,30 * * * *") - twice an hour', () => {
      expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: '0,30 * * * *' }).success).toBe(false);
    });

    it('rejects a range in the minute field ("0-10 * * * *") - eleven times an hour', () => {
      expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: '0-10 * * * *' }).success).toBe(false);
    });

    it('rejects a step even when it technically resolves to at most once per hour ("0/60 * * * *") - simplicity over cleverness', () => {
      expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: '0/60 * * * *' }).success).toBe(false);
    });

    it('accepts a single fixed minute ("0 * * * *") - fires once an hour, exactly at the floor', () => {
      expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: '0 * * * *' }).success).toBe(true);
    });

    it('accepts every existing preset (lib/schedulePresets.ts) - daily/weekly/monthly all have a single fixed minute', () => {
      expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: '0 6 * * *' }).success).toBe(true); // daily
      expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: '0 6 * * 1' }).success).toBe(true); // weekly
      expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: '0 6 1 * *' }).success).toBe(true); // monthly
    });

    it('a non-zero but still-single-value minute ("15 * * * *") is accepted - the rule is "one literal value", not "must be zero"', () => {
      expect(CreateExportSchema.safeParse({ ...BASE, scheduleCron: '15 * * * *' }).success).toBe(true);
    });
  });
});

describe('PatchExportSchema', () => {
  it('accepts { isActive: true }', () => {
    expect(PatchExportSchema.safeParse({ isActive: true }).success).toBe(true);
  });

  it('accepts { isActive: false }', () => {
    expect(PatchExportSchema.safeParse({ isActive: false }).success).toBe(true);
  });

  it('rejects a missing isActive', () => {
    expect(PatchExportSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a non-boolean isActive', () => {
    expect(PatchExportSchema.safeParse({ isActive: 'true' }).success).toBe(false);
  });
});
