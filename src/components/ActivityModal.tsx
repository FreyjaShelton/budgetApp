import { Link } from 'react-router-dom';
import { activityLines } from '../lib/budget';
import { formatMoney } from '../lib/money';
import { formatDate, formatMonth } from '../lib/month';
import type { BudgetData, Category, Cents, MonthKey } from '../types';
import { Modal, Money } from './common';

/** The transactions behind a category's Activity number for one month. */
export function ActivityModal({
  data,
  category,
  month,
  activity,
  onClose,
}: {
  data: BudgetData;
  category: Category;
  month: MonthKey;
  /** The engine's activity figure, shown as the total. */
  activity: Cents;
  onClose: () => void;
}) {
  const lines = activityLines(data, category, month);
  const accounts = new Map(data.accounts.map((a) => [a.id, a.name]));
  const isPayment = !!category.linkedAccountId;
  const listed = lines.reduce((s, l) => s + l.amount, 0);
  // For a card payment category, the rest of its activity is budgeted card spending moved in.
  const movedIn = isPayment ? activity - listed : 0;

  return (
    <Modal wide title={`${category.name}: ${formatMonth(month)} activity`} onClose={onClose}>
      {lines.length === 0 && movedIn === 0 ? (
        <p className="muted" style={{ margin: 0 }}>
          No transactions in this category in {formatMonth(month)}.
        </p>
      ) : (
        <div className="activity-scroll">
          <table className="grid activity-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Payee</th>
                <th className="hide-mobile">Account</th>
                <th className="hide-mobile">Memo</th>
                <th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {isPayment && movedIn !== 0 && (
                <tr>
                  <td colSpan={2}>
                    <strong>Card spending covered by your budget</strong>
                    <div className="muted" style={{ fontSize: 12 }}>
                      Budgeted purchases on this card, moved here from their categories to pay the bill
                    </div>
                  </td>
                  <td className="hide-mobile" />
                  <td className="hide-mobile" />
                  <td className="num">
                    <Money cents={movedIn} colored />
                  </td>
                </tr>
              )}
              {lines.map((l) => (
                <tr key={`${l.txn.id}`}>
                  <td style={{ whiteSpace: 'nowrap' }}>{formatDate(l.txn.date)}</td>
                  <td>
                    {isPayment ? 'Payment' : l.txn.payee}
                    {l.isSplit && <span className="tag">split</span>}
                    <div className="muted show-mobile" style={{ fontSize: 12 }}>
                      {accounts.get(l.txn.accountId)}
                      {l.txn.memo && ` · ${l.txn.memo}`}
                    </div>
                  </td>
                  <td className="hide-mobile">
                    <Link to={`/accounts/${l.txn.accountId}`} onClick={onClose}>
                      {accounts.get(l.txn.accountId)}
                    </Link>
                  </td>
                  <td className="hide-mobile muted">{l.isSplit ? (l.txn.splits?.find((s) => s.categoryId === category.id)?.memo ?? l.txn.memo) : l.txn.memo}</td>
                  <td className="num">
                    <Money cents={l.amount} colored />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>
                  <strong>Total activity</strong>
                  <span className="muted"> · {lines.length} transaction{lines.length === 1 ? '' : 's'}</span>
                </td>
                <td className="hide-mobile" />
                <td className="hide-mobile" />
                <td className="num">
                  <strong>{formatMoney(activity)}</strong>
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Modal>
  );
}
