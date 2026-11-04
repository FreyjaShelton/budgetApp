import { describe, expect, it } from 'vitest';
import { categoryBar } from './bars';
import type { CategoryMonth } from './budget';

const cm = (p: Partial<CategoryMonth>): CategoryMonth => {
  const base = { carryIn: 0, assigned: 0, activity: 0, cashOverspent: 0, creditOverspent: 0, ...p };
  return { available: base.carryIn + base.assigned + base.activity, ...base };
};
const shape = (segs: ReturnType<typeof categoryBar>) => segs.map((s) => [s.kind, s.amount, +s.fraction.toFixed(2)]);

describe('categoryBar', () => {
  it('splits assigned money into spent and still available', () => {
    expect(shape(categoryBar(cm({ assigned: 10000, activity: -2500 }), 0))).toEqual([
      ['spent', 2500, 0.25],
      ['available', 7500, 0.75],
    ]);
  });

  it('counts carried-over money and adds what a target still needs', () => {
    expect(shape(categoryBar(cm({ carryIn: 2000, assigned: 3000, activity: -1000 }), 5000))).toEqual([
      ['spent', 1000, 0.1],
      ['available', 4000, 0.4],
      ['needed', 5000, 0.5],
    ]);
  });

  it('shows overspending past the funded amount', () => {
    const c = cm({ assigned: 10000, activity: -12000, cashOverspent: 2000 });
    expect(shape(categoryBar(c, 0))).toEqual([
      ['spent', 10000, 0.83],
      ['overCash', 2000, 0.17],
    ]);
    const credit = cm({ assigned: 10000, activity: -15000, creditOverspent: 5000 });
    expect(categoryBar(credit, 0).map((s) => s.kind)).toEqual(['spent', 'overCredit']);
  });

  it('treats net refunds as available money, and is empty for an untouched category', () => {
    expect(shape(categoryBar(cm({ assigned: 1000, activity: 500 }), 0))).toEqual([['available', 1500, 1]]);
    expect(categoryBar(cm({}), 0)).toEqual([]);
  });
});
