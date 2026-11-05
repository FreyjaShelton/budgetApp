import { useEffect, useState, useSyncExternalStore, type InputHTMLAttributes, type ReactNode } from 'react';
import { centsToInput, evaluateNumber, formatComputed, formatMoney, hasMath, parseMoney } from '../lib/money';
import { RTA, type BudgetData, type Cents } from '../types';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
  );
}

export function Money({ cents, colored = false }: { cents: Cents; colored?: boolean }) {
  const cls = colored ? (cents < 0 ? 'neg' : cents > 0 ? 'pos' : '') : cents < 0 ? 'neg' : '';
  return <span className={cls}>{formatMoney(cents)}</span>;
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <header>
          <h2>{title}</h2>
          <span className="spacer" />
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </div>
    </div>
  );
}

/**
 * Text input for money. Supports math ("120+35"). Commits on blur or Enter;
 * Escape reverts. `onCommit` only fires when the value actually changes.
 */
export function MoneyInput({
  value,
  onCommit,
  placeholder,
  autoFocus,
  className,
  ariaLabel,
  onFocus,
}: {
  value: Cents;
  onCommit: (cents: Cents) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  ariaLabel?: string;
  onFocus?: () => void;
}) {
  const [text, setText] = useState(value ? centsToInput(value) : '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(value ? centsToInput(value) : '');
  }, [value, focused]);

  const commit = () => {
    const parsed = text.trim() === '' ? 0 : parseMoney(text);
    if (parsed === null) {
      setText(value ? centsToInput(value) : '');
      return;
    }
    if (parsed !== value) onCommit(parsed);
    setText(parsed ? centsToInput(parsed) : '');
  };

  return (
    <input
      className={className}
      inputMode="decimal"
      value={focused ? text : value ? formatMoney(value) : ''}
      placeholder={placeholder ?? formatMoney(0)}
      autoFocus={autoFocus}
      aria-label={ariaLabel}
      onFocus={(e) => {
        onFocus?.();
        setFocused(true);
        setText(value ? centsToInput(value) : '');
        requestAnimationFrame(() => e.target.select());
      }}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setText(value ? centsToInput(value) : '');
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

/**
 * A number field that understands math. Type "2+2", "120.50*2" or "300/3" and it becomes the
 * result when you press Enter or leave the field. The value stays a string, so forms parse it
 * the same way they always have.
 */
export function MathInput({
  value,
  onChange,
  decimals = 2,
  onKeyDown,
  onBlur,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> & {
  value: string;
  onChange: (value: string) => void;
  /** Decimal places for a computed result (2 for money; more for rates). */
  decimals?: number;
}) {
  const settle = () => {
    if (!hasMath(value)) return;
    const result = evaluateNumber(value);
    if (result !== null) onChange(formatComputed(result, decimals));
  };
  return (
    <input
      inputMode="decimal"
      {...rest}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') settle();
        onKeyDown?.(e);
      }}
      onBlur={(e) => {
        settle();
        onBlur?.(e);
      }}
    />
  );
}

/** Controlled text field that holds a money string; parse it yourself on submit. */
export function useMoneyField(initial: Cents | null) {
  const [text, setText] = useState(initial ? centsToInput(Math.abs(initial)) : '');
  const cents = text.trim() ? parseMoney(text) : 0;
  return { text, setText, cents };
}

export function CategorySelect({
  data,
  value,
  onChange,
  includeRta = true,
  includePayment = false,
  allowNone = true,
  noneLabel = 'Uncategorized',
  id,
}: {
  data: BudgetData;
  value: string | null;
  onChange: (id: string | null) => void;
  includeRta?: boolean;
  includePayment?: boolean;
  allowNone?: boolean;
  noneLabel?: string;
  id?: string;
}) {
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
      {allowNone && <option value="">{noneLabel}</option>}
      {includeRta && <option value={RTA}>Inflow: Ready to Assign</option>}
      {data.groups
        .filter((g) => includePayment || !g.isCreditCardGroup)
        .map((g) => (
          <optgroup key={g.id} label={g.name}>
            {data.categories
              .filter((c) => c.groupId === g.id && (!c.hidden || c.id === value))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </optgroup>
        ))}
    </select>
  );
}

export function categoryName(data: BudgetData, id: string | null): string {
  if (!id) return '';
  if (id === RTA) return 'Ready to Assign';
  return data.categories.find((c) => c.id === id)?.name ?? '(deleted)';
}

export function downloadFile(name: string, content: string, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
