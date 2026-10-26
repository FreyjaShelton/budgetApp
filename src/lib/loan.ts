import type { Cents } from '../types';

export interface PayoffResult {
  months: number;
  totalInterest: Cents;
  /** Balance at the start and after each month's payment. */
  schedule: Cents[];
  /** True when the payment doesn't cover the interest, so the loan never gets paid off. */
  neverPaysOff: boolean;
}

/** Simulate paying `payment` each month on a loan with the given APR (6.5 means 6.5%). */
export function payoff(balance: Cents, aprPercent: number, payment: Cents, maxMonths = 1200): PayoffResult {
  const rate = aprPercent / 100 / 12;
  let bal = balance;
  let interest = 0;
  const schedule = [bal];
  let months = 0;
  while (bal > 0 && months < maxMonths) {
    const i = Math.round(bal * rate);
    if (payment <= i) return { months: Infinity, totalInterest: Infinity, schedule, neverPaysOff: true };
    interest += i;
    bal = Math.max(0, bal + i - payment);
    schedule.push(bal);
    months++;
  }
  return { months, totalInterest: interest, schedule, neverPaysOff: bal > 0 };
}

/** Standard amortized monthly payment for a fixed-term loan. */
export function amortizedPayment(balance: Cents, aprPercent: number, termMonths: number): Cents {
  const r = aprPercent / 100 / 12;
  if (r === 0) return Math.ceil(balance / termMonths);
  return Math.ceil((balance * r) / (1 - Math.pow(1 + r, -termMonths)));
}
