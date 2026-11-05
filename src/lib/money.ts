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
 * Evaluate a typed number or simple arithmetic: "$1,234.56", "-12", "(12.00)", "100+25.5",
 * "300/2", "2x3" or "10 ÷ 4". Returns the unrounded value, or null if it can't be understood.
 */
export function evaluateNumber(input: string): number | null {
  let s = input.trim();
  if (!s) return null;
  let negate = false;
  if (/^\(.*\)$/.test(s)) {
    negate = true;
    s = s.slice(1, -1);
  }
  s = s
    .replace(/[$,\s]/g, '')
    .replace(/[×xX]/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-');
  if (!/^[-+]?[\d.]+([-+*/][-+]?[\d.]+)*$/.test(s)) return null;
  const value = evalArithmetic(s);
  if (value === null || !Number.isFinite(value)) return null;
  return negate ? -value : value;
}

/** Show a computed result in a field: money keeps 2 decimals ("4.00"); rates drop trailing zeros ("6.5"). */
export function formatComputed(value: number, decimals = 2): string {
  return decimals === 2 ? value.toFixed(2) : String(Number(value.toFixed(decimals)));
}

/** True when the text contains arithmetic (an operator after the first character). */
export function hasMath(input: string): boolean {
  return /[-+*/×xX÷−–]/.test(input.trim().slice(1));
}

/** Parse user input into cents, with the same arithmetic support as evaluateNumber. */
export function parseMoney(input: string): Cents | null {
  const value = evaluateNumber(input);
  return value === null ? null : Math.round(value * 100);
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
