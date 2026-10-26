import { describe, expect, it } from 'vitest';
import { applyCsvMapping, findDuplicates, guessMapping, parseCsvRows, parseOfx } from './importers';
import { amortizedPayment, payoff } from './loan';
import { parseMoney } from './money';
import { addMonths, monthDiff } from './month';

describe('parseMoney', () => {
  it.each([
    ['12.34', 1234],
    ['$1,234.56', 123456],
    ['-5', -500],
    ['(7.25)', -725],
    ['100+25.5', 12550],
    ['300/2', 15000],
    ['10-2*3', 400],
    ['-3+1', -200],
  ])('%s -> %i', (input, cents) => expect(parseMoney(input)).toBe(cents));

  it.each(['', 'abc', '1+', '5/0'])('rejects %j', (input) => expect(parseMoney(input)).toBeNull());
});

describe('months', () => {
  it('adds across years', () => {
    expect(addMonths('2026-11', 3)).toBe('2027-02');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
    expect(monthDiff('2025-12', '2026-03')).toBe(3);
  });
});

describe('OFX', () => {
  it('parses SGML statements', () => {
    const ofx = `OFXHEADER:100
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKTRANLIST>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260105120000<TRNAMT>-42.10<FITID>A1<NAME>Trader Joe&amp;s<MEMO>POS
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260115<TRNAMT>2000.00<FITID>A2<NAME>Payroll
</BANKTRANLIST></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`;
    const t = parseOfx(ofx);
    expect(t).toHaveLength(2);
    expect(t[0]).toMatchObject({ date: '2026-01-05', amount: -4210, payee: 'Trader Joe&s', memo: 'POS', importId: 'ofx:A1' });
    expect(t[1]).toMatchObject({ date: '2026-01-15', amount: 200000, payee: 'Payroll' });
  });

  it('parses XML statements', () => {
    const ofx = `<OFX><BANKTRANLIST><STMTTRN><DTPOSTED>20260201</DTPOSTED><TRNAMT>-9.99</TRNAMT><FITID>X</FITID><NAME>Netflix</NAME></STMTTRN></BANKTRANLIST></OFX>`;
    expect(parseOfx(ofx)).toEqual([{ date: '2026-02-01', amount: -999, payee: 'Netflix', memo: undefined, importId: 'ofx:X' }]);
  });
});

describe('CSV', () => {
  it('guesses mapping with separate debit/credit columns', () => {
    const rows = parseCsvRows('Date,Description,Debit,Credit\n01/05/2026,Coffee,4.50,\n01/06/2026,Refund,,10.00\n');
    const map = guessMapping(rows);
    expect(map).toMatchObject({ hasHeader: true, date: 0, payee: 1, amount: null, outflow: 2, inflow: 3, dateFormat: 'MDY' });
    const { txns, errors } = applyCsvMapping(rows, map);
    expect(errors).toBe(0);
    expect(txns.map((t) => [t.date, t.amount])).toEqual([
      ['2026-01-05', -450],
      ['2026-01-06', 1000],
    ]);
  });

  it('detects day-first dates and keeps identical rows distinct', () => {
    const rows = parseCsvRows('Date,Payee,Amount\n25/01/2026,Bus,-2.00\n25/01/2026,Bus,-2.00\n');
    const { txns } = applyCsvMapping(rows, guessMapping(rows));
    expect(txns[0].date).toBe('2026-01-25');
    expect(new Set(txns.map((t) => t.importId)).size).toBe(2);
  });

  it('flags duplicates by import id and by manual entries', () => {
    const incoming = [
      { date: '2026-01-05', payee: 'A', amount: -100, importId: 'ofx:1' },
      { date: '2026-01-06', payee: 'B', amount: -200, importId: 'ofx:2' },
      { date: '2026-01-07', payee: 'C', amount: -300, importId: 'ofx:3' },
    ];
    const existing = [
      { date: '2026-01-05', amount: -100, importId: 'ofx:1' },
      { date: '2026-01-04', amount: -200 },
    ];
    const { fresh, dupes } = findDuplicates(incoming, existing);
    expect(dupes.map((d) => d.payee)).toEqual(['A', 'B']);
    expect(fresh.map((d) => d.payee)).toEqual(['C']);
  });
});

describe('loan', () => {
  it('computes amortized payment and payoff', () => {
    const pmt = amortizedPayment(1000000, 6, 60); // $10k, 6%, 5 years
    expect(pmt).toBe(19333);
    const r = payoff(1000000, 6, pmt);
    expect(r.months).toBe(60);
    const faster = payoff(1000000, 6, pmt + 10000);
    expect(faster.months).toBeLessThan(60);
    expect(faster.totalInterest).toBeLessThan(r.totalInterest);
  });

  it('detects payments that never pay off', () => {
    expect(payoff(1000000, 24, 10000).neverPaysOff).toBe(true);
  });
});
