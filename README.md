# budgetApp

A personal zero-based budgeting app meant to replace YNAB. It runs entirely in the browser: your data is stored locally in IndexedDB, and there's no server or account.

## Running it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests for the budget engine, importers, loan math
npm run build    # static site in dist/ (open from any static host)
```

## Features

| YNAB feature | Here |
| --- | --- |
| Give every dollar a job | **Plan** screen: Ready to Assign, Assigned / Activity / Available per category, month-by-month. Amount fields accept math (`200+45`). |
| Rollover & overspending | Positive balances roll over. Cash overspending resets to zero and comes out of next month's Ready to Assign. Unfunded credit card spending becomes card debt (yellow). |
| Credit card handling | Each card gets a payment category. Budgeted card spending moves money into it, and payments from checking draw it down. |
| Goal tracking | Targets: monthly set-aside, monthly refill-up-to, have-X-by-date, savings balance. Progress bars, "more needed" hints, and **Assign underfunded**. |
| Quick assign / move money | Inspector panel: underfunded, last month, averages, cover overspending, move money between categories. |
| Accounts | Checking, savings, cash, credit cards (budget), and asset/loan tracking accounts. Cleared/uncleared, reconcile with adjustment, close/reopen. |
| Transactions | Inline register with splits, transfers (`Transfer : Account`), memos, payee autocomplete, payee → category memory, bulk categorize/clear/delete, search & filters. |
| Bank import | CSV (with column mapping, date-format and sign detection) and OFX/QFX, with duplicate detection. |
| Reports | Spending by category/group, spending per month, income vs. expense, net worth. Each has a chart and a table. |
| Loan calculator | Payoff time and interest saved from extra payments; prefill from a debt account. |
| Category templates | Starter / Minimal / Family presets. |
| Backup | JSON backup & restore, CSV export of transactions. |
| Cross-device sync | Settings → Sync with Google Drive. Data is encrypted in the browser with a passphrase (PBKDF2 + AES-GCM) and stored in Drive's hidden app folder (`drive.appdata` scope only). Edits from different devices merge record by record. |

Not built (yet): automatic bank sync, sharing, receipt photos, scheduled/recurring transactions.

## Code map

- `src/lib/budget.ts`: the budget engine (pure functions, the most important file). Tests: `budget.test.ts`.
- `src/lib/importers.ts`: CSV/OFX parsing and duplicate detection.
- `src/lib/reports.ts`, `src/lib/loan.ts`: report and payoff math.
- `src/actions.ts`: all writes to the database (keeps transfer pairs and card payment categories in sync).
- `src/db.ts`: Dexie (IndexedDB) schema and the live data hook.
- `src/sync/`: encryption (`crypto.ts`), three-way merge (`merge.ts`), Drive client (`drive.ts`), sync loop (`engine.ts`).
- `src/pages/*`, `src/components/*`: React UI.

Money is stored as integer cents everywhere.

> ⚠️ Data lives only in the browser profile you use. Clearing site data deletes it, so download a backup from **Settings** regularly.

## Deployment

Hosted on Cloudflare Workers (static assets, see `wrangler.jsonc`), which builds from this
private repo on every push to `main`: build command `npm run build`, deploy command
`npx wrangler deploy`, Node version from `.node-version`. Cloudflare Access restricts the
site to the owner's email.

Google Drive sync uses the OAuth client ID in `.env` (`VITE_GOOGLE_CLIENT_ID`), from Google Cloud
project `budget-sync-512813`. Its authorized JavaScript origins are the workers.dev URL and
`http://localhost:5173`; add any new domain there too.
