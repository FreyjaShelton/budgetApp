import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { filterPayees, type PayeeInfo } from '../lib/payees';

/** At least as wide as the input (240px minimum), kept inside the screen. */
function listPosition(rect: DOMRect) {
  const width = Math.min(Math.max(rect.width, 240), window.innerWidth - 16);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 8 - width));
  return { left, top: rect.bottom + 2, width };
}

export interface PayeeOption {
  name: string;
  /** Shown faded on the right, e.g. the category the payee last used. */
  detail?: string;
  section: 'Transfers' | 'Payees';
}

/**
 * Payee field with a dropdown of previous payees (most recent first) and transfer targets.
 * Typing filters the list. Choosing an option calls onPick, so the caller can fill in the
 * payee's usual category. The list floats above the page, so table cells can't clip it.
 */
export function PayeeCombobox({
  value,
  onChange,
  onPick,
  payees,
  transferNames,
  categoryLabel,
  autoFocus,
  onBlur,
}: {
  value: string;
  onChange: (value: string) => void;
  onPick: (name: string) => void;
  payees: PayeeInfo[];
  /** e.g. "Transfer : Savings" */
  transferNames: string[];
  categoryLabel: (categoryId: string | null) => string;
  autoFocus?: boolean;
  onBlur?: () => void;
}) {
  const [open, setOpen] = useState(false);
  /** Opened by clicking/focusing (not typing): show every payee, not just matches for the current text. */
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(-1);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const listId = useId();

  const options = useMemo<PayeeOption[]>(() => {
    const q = showAll ? '' : value.trim().toLowerCase();
    const transfers = transferNames
      .filter((t) => !q || t.toLowerCase().includes(q) || 'transfer'.startsWith(q))
      .map((name) => ({ name, section: 'Transfers' as const }));
    const people = filterPayees(payees, q).map((p) => ({ name: p.name, detail: categoryLabel(p.categoryId), section: 'Payees' as const }));
    // Hide the list when the text already exactly matches the only suggestion.
    const all = [...people, ...transfers];
    return all.length === 1 && all[0].name.toLowerCase() === q ? [] : all;
  }, [value, showAll, payees, transferNames, categoryLabel]);

  // Position the floating list under the input, and keep it there while scrolling/resizing.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => inputRef.current && setRect(inputRef.current.getBoundingClientRect());
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [open]);

  useEffect(() => setActive(-1), [value]);
  useEffect(() => {
    if (active >= 0) listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const choose = (name: string) => {
    onChange(name);
    onPick(name);
    setOpen(false);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const showing = open && options.length > 0;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open) {
        setShowAll(true);
        setOpen(true);
      }
      setActive((i) => Math.min(options.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter' && showing && active >= 0) {
      // Choosing a suggestion; don't also save the transaction.
      e.preventDefault();
      e.stopPropagation();
      choose(options[active].name);
    } else if (e.key === 'Escape' && showing) {
      // Close the list without cancelling the whole edit.
      e.stopPropagation();
      setOpen(false);
    }
  };

  const showList = open && options.length > 0 && rect;
  let lastSection = '';

  return (
    <div className="payee-combo">
      <input
        ref={inputRef}
        value={value}
        autoFocus={autoFocus}
        placeholder="Payee"
        aria-label="Payee"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={!!showList}
        aria-controls={listId}
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        autoComplete="off"
        onChange={(e) => {
          onChange(e.target.value);
          setShowAll(false);
          setOpen(true);
        }}
        // Focus alone (e.g. opening a transaction for editing) doesn't open the list;
        // clicking into the field, typing, the ▾ button or ↓ do.
        onClick={() => {
          setShowAll(true);
          setOpen(true);
        }}
        onBlur={() => {
          setOpen(false);
          onBlur?.();
        }}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="payee-toggle"
        tabIndex={-1}
        aria-label="Show previous payees"
        onMouseDown={(e) => {
          // Keep focus in the input; just toggle the list.
          e.preventDefault();
          inputRef.current?.focus();
          setShowAll(true);
          setOpen((o) => !o);
        }}
      >
        ▾
      </button>
      {showList &&
        createPortal(
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            className="payee-list"
            style={listPosition(rect)}
          >
            {options.map((o, i) => {
              const header = o.section !== lastSection && (lastSection !== '' || o.section === 'Transfers');
              lastSection = o.section;
              return (
                <li key={`${o.section}:${o.name}`} role="presentation">
                  {header && <div className="payee-section">{o.section}</div>}
                  <div
                    id={`${listId}-${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === active}
                    className={`payee-option${i === active ? ' active' : ''}`}
                    // mousedown (not click) so the choice lands before the input's blur closes the list
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(o.name);
                    }}
                    onMouseEnter={() => setActive(i)}
                  >
                    <span className="payee-name">{o.name}</span>
                    {o.detail && <span className="payee-detail">{o.detail}</span>}
                  </div>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
