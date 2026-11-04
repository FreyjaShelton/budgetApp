import type { Cents } from '../types';
import type { CategoryMonth } from './budget';

export type SegmentKind = 'spent' | 'available' | 'needed' | 'overCash' | 'overCredit';

export interface Segment {
  kind: SegmentKind;
  amount: Cents;
  /** Share of the bar, 0..1. */
  fraction: number;
}

/**
 * Category bar, left to right: money spent (striped), money still available (solid), what the
 * target still needs this month, and any overspending beyond the money the category had.
 * "Had" = carried over + assigned + any net inflow (refunds) this month.
 */
export function categoryBar(cm: CategoryMonth, needed: Cents): Segment[] {
  const spent = Math.max(0, -cm.activity);
  const funded = Math.max(0, cm.carryIn + cm.assigned + Math.max(0, cm.activity));
  const overspent = Math.max(0, spent - funded);
  const parts: [SegmentKind, Cents][] = [
    ['spent', spent - overspent],
    ['available', Math.max(0, cm.available)],
    ['needed', Math.max(0, needed)],
    [cm.cashOverspent > 0 ? 'overCash' : 'overCredit', overspent],
  ];
  const total = parts.reduce((s, [, a]) => s + a, 0);
  if (total <= 0) return [];
  return parts.filter(([, a]) => a > 0).map(([kind, amount]) => ({ kind, amount, fraction: amount / total }));
}
