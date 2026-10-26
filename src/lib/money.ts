import type { Cents } from '../types';

const fmt = new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD' });

export function formatMoney(cents: Cents): string {
  return fmt.format(cents / 100);
}

/** Plain number string for editing, e.g. 1234 -> "12.34". */
export function centsToInput(cents: Cents): string {
  return (cents / 100).toFixed(2);
}

/**
 * Parse user input into cents. Accepts "$1,234.56", "-12", "(12.00)", and simple
 * arithmetic such as "100+25.5" or "300/2" so users can do math in amount fields.
 * Returns null when the input can't be understood.
 */
export function parseMoney(input: string): Cents | null {
  let s = input.trim();
  if (!s) return null;
  let negate = false;
  if (/^\(.*\)$/.test(s)) {
    negate = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[$,\s]/g, '');
  if (!/^[-+]?[\d.]+([-+*/][-+]?[\d.]+)*$/.test(s)) return null;
  const value = evalArithmetic(s);
  if (value === null || !Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return negate ? -cents : cents;
}

/** Evaluates + - * / with normal precedence. Input is pre-validated to digits, dots and operators. */
function evalArithmetic(expr: string): number | null {
  const nums: number[] = [];
  const ops: string[] = [];
  let i = 0;
  while (i < expr.length) {
    // A number, optionally signed (sign allowed at start or right after an operator).
    let j = i;
    if (expr[j] === '-' || expr[j] === '+') j++;
    while (j < expr.length && /[\d.]/.test(expr[j])) j++;
    const n = Number(expr.slice(i, j));
    if (j === i || Number.isNaN(n)) return null;
    nums.push(n);
    if (j >= expr.length) break;
    ops.push(expr[j]);
    i = j + 1;
    if (i >= expr.length) return null;
  }
  // * and / first
  const terms: number[] = [nums[0]];
  const addOps: string[] = [];
  for (let k = 0; k < ops.length; k++) {
    const next = nums[k + 1];
    if (ops[k] === '*') terms[terms.length - 1] *= next;
    else if (ops[k] === '/') {
      if (next === 0) return null;
      terms[terms.length - 1] /= next;
    } else {
      addOps.push(ops[k]);
      terms.push(next);
    }
  }
  let result = terms[0];
  for (let k = 0; k < addOps.length; k++) result = addOps[k] === '+' ? result + terms[k + 1] : result - terms[k + 1];
  return result;
}
