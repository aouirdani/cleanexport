import { describe, it, expect } from 'vitest';
import {
  matchesSearch,
  filterProperties,
  sortForBrowsing,
  addProperty,
  removeProperty,
  reorder,
  moveProperty,
  computeVirtualRange,
  MAX_EXPORT_PROPERTIES,
  type PickerProperty,
} from '@/lib/propertyPicker';

function prop(overrides: Partial<PickerProperty> & { name: string }): PickerProperty {
  return {
    label: overrides.name,
    type: 'string',
    fieldType: 'text',
    isSystem: false,
    description: null,
    calculated: false,
    hidden: false,
    ...overrides,
  };
}

describe('matchesSearch / filterProperties - search matches BOTH name and label', () => {
  it('matches on the internal name', () => {
    expect(matchesSearch({ name: 'firstname', label: 'First Name' }, 'firstn')).toBe(true);
  });

  it('matches on the human label', () => {
    expect(matchesSearch({ name: 'firstname', label: 'First Name' }, 'First N')).toBe(true);
  });

  it('is case-insensitive on both fields', () => {
    expect(matchesSearch({ name: 'firstname', label: 'First Name' }, 'FIRSTNAME')).toBe(true);
    expect(matchesSearch({ name: 'firstname', label: 'First Name' }, 'first name')).toBe(true);
  });

  it('an empty query matches everything', () => {
    expect(matchesSearch({ name: 'firstname', label: 'First Name' }, '')).toBe(true);
    expect(matchesSearch({ name: 'firstname', label: 'First Name' }, '   ')).toBe(true);
  });

  it('does not match when neither name nor label contains the query', () => {
    expect(matchesSearch({ name: 'firstname', label: 'First Name' }, 'lastname')).toBe(false);
  });

  it('filterProperties applies the same rule across a list', () => {
    const properties = [
      prop({ name: 'firstname', label: 'First Name' }),
      prop({ name: 'lastname', label: 'Last Name' }),
      prop({ name: 'email', label: 'Email Address' }),
    ];
    expect(filterProperties(properties, { search: 'name' }).map((p) => p.name)).toEqual([
      'firstname',
      'lastname',
    ]);
    expect(filterProperties(properties, { search: 'address' }).map((p) => p.name)).toEqual(['email']);
  });
});

describe('filterProperties - the system-properties toggle', () => {
  const properties = [
    prop({ name: 'firstname', label: 'First Name', isSystem: false }),
    prop({ name: 'hs_object_id', label: 'Object ID', isSystem: true }),
    prop({ name: 'hs_lead_status', label: 'Lead Status', isSystem: true }),
  ];

  it('is OFF by default - system properties are excluded when the option is omitted', () => {
    expect(filterProperties(properties).map((p) => p.name)).toEqual(['firstname']);
  });

  it('is OFF by default - explicit showSystem: false behaves the same', () => {
    expect(filterProperties(properties, { showSystem: false }).map((p) => p.name)).toEqual(['firstname']);
  });

  it('showSystem: true includes system properties alongside user-facing ones', () => {
    expect(filterProperties(properties, { showSystem: true }).map((p) => p.name)).toEqual([
      'firstname',
      'hs_object_id',
      'hs_lead_status',
    ]);
  });

  it('combines with search - a system property only shows when both conditions pass', () => {
    expect(filterProperties(properties, { search: 'lead', showSystem: false })).toEqual([]);
    expect(filterProperties(properties, { search: 'lead', showSystem: true }).map((p) => p.name)).toEqual([
      'hs_lead_status',
    ]);
  });
});

describe('selection survives a search that would hide an already-selected property', () => {
  it('the selected array is untouched by filtering the available list', () => {
    const properties = [
      prop({ name: 'firstname', label: 'First Name' }),
      prop({ name: 'lastname', label: 'Last Name' }),
    ];
    let selected: string[] = [];
    ({ selected } = addProperty(selected, 'firstname'));

    // A search that hides "firstname" from the Available pane...
    const available = filterProperties(properties, { search: 'lastname' });
    expect(available.map((p) => p.name)).toEqual(['lastname']);

    // ...must not remove it from the Selected pane, because `selected` is
    // never derived from `available` - they are two independent data flows.
    expect(selected).toEqual(['firstname']);
  });

  it('even a search matching nothing at all leaves selections intact', () => {
    const selected = ['firstname', 'lastname'];
    const properties = [prop({ name: 'firstname' }), prop({ name: 'lastname' })];

    const available = filterProperties(properties, { search: 'zzz-no-match' });

    expect(available).toEqual([]);
    expect(selected).toEqual(['firstname', 'lastname']); // reference is simply never touched
  });
});

describe('sortForBrowsing', () => {
  it('sorts the Available pane alphabetically by label without mutating the input', () => {
    const properties = [prop({ name: 'z', label: 'Zeta' }), prop({ name: 'a', label: 'Alpha' })];
    const sorted = sortForBrowsing(properties);

    expect(sorted.map((p) => p.name)).toEqual(['a', 'z']);
    expect(properties.map((p) => p.name)).toEqual(['z', 'a']); // original order preserved
  });
});

describe('addProperty - the 200-property cap', () => {
  it('adds a new, not-yet-selected property', () => {
    const result = addProperty([], 'firstname');
    expect(result).toEqual({ selected: ['firstname'], added: true, atCap: false });
  });

  it('appends to the END, preserving existing order', () => {
    const result = addProperty(['a', 'b'], 'c');
    expect(result.selected).toEqual(['a', 'b', 'c']);
  });

  it('adding an already-selected property is a no-op, not a duplicate', () => {
    const result = addProperty(['a', 'b'], 'a');
    expect(result).toEqual({ selected: ['a', 'b'], added: false, atCap: false });
  });

  it('refuses to add past the cap and reports atCap', () => {
    const atCap = Array.from({ length: MAX_EXPORT_PROPERTIES }, (_, i) => `p${i}`);
    const result = addProperty(atCap, 'one-more');

    expect(result.added).toBe(false);
    expect(result.atCap).toBe(true);
    expect(result.selected).toHaveLength(MAX_EXPORT_PROPERTIES);
    expect(result.selected).toBe(atCap); // unchanged reference - no copy made on refusal
  });

  it('allows the exact 200th property (cap is inclusive of 200, refuses the 201st)', () => {
    const at199 = Array.from({ length: MAX_EXPORT_PROPERTIES - 1 }, (_, i) => `p${i}`);
    const result = addProperty(at199, 'p199');

    expect(result.added).toBe(true);
    expect(result.selected).toHaveLength(MAX_EXPORT_PROPERTIES);
  });

  it('honours a custom, smaller cap (e.g. association columns)', () => {
    const result = addProperty(['a', 'b'], 'c', 2);
    expect(result).toEqual({ selected: ['a', 'b'], added: false, atCap: true });
  });
});

describe('removeProperty', () => {
  it('removes the named property and preserves the order of the rest', () => {
    expect(removeProperty(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });

  it('removing something not selected is a no-op', () => {
    expect(removeProperty(['a', 'b'], 'z')).toEqual(['a', 'b']);
  });
});

describe('reorder - drag-and-drop and keyboard reordering share this function', () => {
  it('moves an item forward', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 0, 2)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('moves an item backward', () => {
    expect(reorder(['a', 'b', 'c', 'd'], 3, 1)).toEqual(['a', 'd', 'b', 'c']);
  });

  it('a no-op move (from === to) returns the exact same order', () => {
    expect(reorder(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'b', 'c']);
  });

  it('out-of-range indices are refused, returning the original array unchanged', () => {
    const list = ['a', 'b', 'c'];
    expect(reorder(list, -1, 1)).toBe(list);
    expect(reorder(list, 0, 3)).toBe(list);
  });

  it('never sorts - reordering an already-scrambled list keeps it exactly as directed', () => {
    expect(reorder(['z', 'a', 'm'], 2, 0)).toEqual(['m', 'z', 'a']);
  });
});

describe('moveProperty - keyboard Up/Down', () => {
  it('moving up swaps with the previous item', () => {
    expect(moveProperty(['a', 'b', 'c'], 'b', 'up')).toEqual(['b', 'a', 'c']);
  });

  it('moving down swaps with the next item', () => {
    expect(moveProperty(['a', 'b', 'c'], 'b', 'down')).toEqual(['a', 'c', 'b']);
  });

  it('moving the first item up is a no-op', () => {
    expect(moveProperty(['a', 'b', 'c'], 'a', 'up')).toEqual(['a', 'b', 'c']);
  });

  it('moving the last item down is a no-op', () => {
    expect(moveProperty(['a', 'b', 'c'], 'c', 'down')).toEqual(['a', 'b', 'c']);
  });

  it('moving a name that is not in the list is a no-op', () => {
    expect(moveProperty(['a', 'b'], 'zzz', 'up')).toEqual(['a', 'b']);
  });

  it('produces the expected final order across a sequence of moves', () => {
    let order = ['a', 'b', 'c', 'd'];
    order = moveProperty(order, 'd', 'up'); // a b d c
    order = moveProperty(order, 'd', 'up'); // a d b c
    order = moveProperty(order, 'a', 'down'); // d a b c
    expect(order).toEqual(['d', 'a', 'b', 'c']);
  });
});

describe('computeVirtualRange', () => {
  it('starts at the top with no scroll', () => {
    const range = computeVirtualRange({ itemCount: 500, rowHeight: 32, scrollTop: 0, viewportHeight: 320, overscan: 0 });
    expect(range.start).toBe(0);
    expect(range.end).toBe(10); // 320 / 32
    expect(range.offsetY).toBe(0);
    expect(range.totalHeight).toBe(500 * 32);
  });

  it('renders only a small window, not all 500 items, when scrolled partway', () => {
    const range = computeVirtualRange({ itemCount: 500, rowHeight: 32, scrollTop: 3200, viewportHeight: 320, overscan: 2 });
    expect(range.end - range.start).toBeLessThan(20);
    expect(range.start).toBeGreaterThan(0);
  });

  it('clamps the end to itemCount near the bottom of the list', () => {
    const range = computeVirtualRange({ itemCount: 10, rowHeight: 32, scrollTop: 10_000, viewportHeight: 320, overscan: 2 });
    expect(range.end).toBe(10);
  });

  it('an empty list renders nothing', () => {
    const range = computeVirtualRange({ itemCount: 0, rowHeight: 32, scrollTop: 0, viewportHeight: 320 });
    expect(range).toEqual({ start: 0, end: 0, offsetY: 0, totalHeight: 0 });
  });
});
