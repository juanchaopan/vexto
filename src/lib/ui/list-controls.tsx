'use client';

// The filter and sort controls above a list (.docs/design/screens.md, 筛选和排序浮层), shared by
// Articles and Vocabulary. A filter is an icon button that opens a panel of checkboxes with Clear
// and Apply; closing it without Apply changes nothing, and an active filter's button is
// highlighted and names what is chosen. The sort button shows the direction and opens a panel
// whose fields take effect as soon as one is chosen, above the Ascending and Descending buttons.
import { useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './button.tsx';
import { Icon, type IconName } from './icon.tsx';
import { choiceRowClass, Popover, PopoverTitle, usePopover } from './popover.tsx';

const triggerClass =
  'inline-flex min-h-11 flex-none items-center justify-center gap-1.5 rounded border border-line bg-surface px-2.5 py-1.5 text-muted [-webkit-tap-highlight-color:transparent] aria-pressed:border-accent aria-pressed:bg-soft aria-pressed:text-accent';

const footerClass = 'flex justify-end gap-2 border-t border-line pt-[9px]';

export type FilterOption = {
  value: string;
  /** The option's name in the button's accessible name. */
  name: string;
  /** What the row shows; the name when not given. */
  label?: ReactNode;
};

export type FilterControlProps = {
  /** The filter's title, such as `Source`. */
  title: string;
  icon: IconName;
  options: readonly FilterOption[];
  selected: readonly string[];
  /** Applies the checked values; the caller decides what choosing every option means. */
  onApply: (values: string[]) => void;
};

export function FilterControl({ title, icon, options, selected, onApply }: FilterControlProps) {
  const anchor = useRef<HTMLButtonElement>(null);
  const { open, toggle, close } = usePopover(anchor);
  const [draft, setDraft] = useState<string[]>([]);
  const active = selected.length > 0;
  const names = options.filter((option) => selected.includes(option.value)).map((o) => o.name);
  const toggleValue = (value: string) =>
    setDraft((values) =>
      values.includes(value) ? values.filter((one) => one !== value) : [...values, value],
    );
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={triggerClass}
        aria-label={`Filter ${title}${active ? `, ${names.join(', ')}` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-pressed={active}
        onClick={() => {
          setDraft([...selected]);
          toggle();
        }}
      >
        <Icon name={icon} className="size-[15px]!" />
        <Icon name="filter" className="size-[11px]!" />
      </button>
      {open ? (
        <Popover anchor={anchor} label={`Filter ${title}`} width={280} onClose={close}>
          <PopoverTitle title={title} closeLabel="Close filter" onClose={() => close()} />
          <div className="mt-[3px] mb-[9px] grid">
            {options.map((option) => (
              <label key={option.value} className={choiceRowClass}>
                <input
                  type="checkbox"
                  checked={draft.includes(option.value)}
                  onChange={() => toggleValue(option.value)}
                />
                {option.label ?? <span>{option.name}</span>}
              </label>
            ))}
          </div>
          <div className={footerClass}>
            <Button onClick={() => setDraft([])}>Clear</Button>
            <Button
              variant="primary"
              onClick={() => {
                onApply(options.map((o) => o.value).filter((value) => draft.includes(value)));
                close();
              }}
            >
              Apply
            </Button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

export type SortDirection = 'asc' | 'desc';

export type SortControlProps<F extends string> = {
  fields: readonly { value: F; label: string }[];
  field: F;
  direction: SortDirection;
  onField: (field: F) => void;
  onDirection: (direction: SortDirection) => void;
};

const directionClass =
  'flex-1 p-[5px] aria-pressed:border-accent aria-pressed:bg-none aria-pressed:bg-soft aria-pressed:text-accent';

export function SortControl<F extends string>({
  fields,
  field,
  direction,
  onField,
  onDirection,
}: SortControlProps<F>) {
  const anchor = useRef<HTMLButtonElement>(null);
  const { open, toggle, close } = usePopover(anchor);
  const group = useId();
  const label = fields.find((one) => one.value === field)?.label ?? field;
  const ascending = direction === 'asc';
  return (
    <>
      <button
        ref={anchor}
        type="button"
        className={`${triggerClass} ml-auto w-11 p-1.5`}
        aria-label={`Sort by ${label}, ${ascending ? 'ascending' : 'descending'}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon
          name={ascending ? 'arrow-up-narrow-wide' : 'arrow-down-wide-narrow'}
          className="size-[15px]!"
        />
      </button>
      {open ? (
        <Popover anchor={anchor} label="Sort" width={280} onClose={close}>
          <PopoverTitle title="Sort" closeLabel="Close sort" onClose={() => close()} />
          <div className="mt-[3px] mb-[9px] grid">
            {fields.map((one) => (
              <label key={one.value} className={choiceRowClass}>
                <input
                  type="radio"
                  name={group}
                  checked={one.value === field}
                  onChange={() => onField(one.value)}
                />
                <span>{one.label}</span>
              </label>
            ))}
          </div>
          <div className={footerClass}>
            <Button
              className={directionClass}
              aria-pressed={ascending}
              onClick={() => onDirection('asc')}
            >
              <Icon name="arrow-up" />
              Ascending
            </Button>
            <Button
              className={directionClass}
              aria-pressed={!ascending}
              onClick={() => onDirection('desc')}
            >
              <Icon name="arrow-down" />
              Descending
            </Button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}
