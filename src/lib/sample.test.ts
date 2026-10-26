import { describe, expect, it } from 'vitest';
import { computeBudget, uncategorized } from './budget';
import { currentMonth } from './month';
import { sampleData } from './sample';

describe('sample data', () => {
  it('produces a sensible budget', () => {
    const d = sampleData();
    const months = computeBudget(d, currentMonth());
    for (const s of months.values()) expect(s.readyToAssign).toBeGreaterThanOrEqual(0);
    expect(uncategorized(d)).toHaveLength(1);
  });
});
