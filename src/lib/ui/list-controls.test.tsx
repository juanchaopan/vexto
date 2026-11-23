import { cleanup, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { FilterControl, SortControl, type SortDirection } from './list-controls.tsx';

afterEach(() => {
  cleanup();
});

const options = [
  { value: 'a', name: 'Alpha' },
  { value: 'b', name: 'Beta' },
  { value: 'c', name: 'Gamma' },
];

function Filter({ onApply }: { onApply: (values: string[]) => void }) {
  const [selected, setSelected] = useState<string[]>([]);
  return (
    <>
      <p>Outside</p>
      <FilterControl
        title="Source"
        icon="building-2"
        options={options}
        selected={selected}
        onApply={(values) => {
          onApply(values);
          setSelected(values);
        }}
      />
    </>
  );
}

const panel = () => screen.queryByRole('dialog', { name: 'Filter Source' });

describe('FilterControl', () => {
  it('applies the checked options in their order and names them on the pressed button', async () => {
    const onApply = vi.fn();
    render(<Filter onApply={onApply} />);
    const button = screen.getByRole('button', { name: 'Filter Source' });
    expect(button).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    await userEvent.click(within(panel()!).getByRole('checkbox', { name: 'Gamma' }));
    await userEvent.click(within(panel()!).getByRole('checkbox', { name: 'Alpha' }));
    await userEvent.click(within(panel()!).getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith(['a', 'c']);
    expect(panel()).toBeNull();
    const pressed = screen.getByRole('button', { name: 'Filter Source, Alpha, Gamma' });
    expect(pressed).toHaveAttribute('aria-pressed', 'true');
    expect(document.activeElement).toBe(pressed);
  });

  it('clears the checks with Clear and changes nothing when closed without Apply', async () => {
    const onApply = vi.fn();
    render(<Filter onApply={onApply} />);
    await userEvent.click(screen.getByRole('button', { name: 'Filter Source' }));
    await userEvent.click(within(panel()!).getByRole('checkbox', { name: 'Beta' }));
    await userEvent.click(within(panel()!).getByRole('button', { name: 'Apply' }));

    await userEvent.click(screen.getByRole('button', { name: 'Filter Source, Beta' }));
    expect(within(panel()!).getByRole('checkbox', { name: 'Beta' })).toBeChecked();
    await userEvent.click(within(panel()!).getByRole('button', { name: 'Clear' }));
    expect(within(panel()!).getByRole('checkbox', { name: 'Beta' })).not.toBeChecked();
    await userEvent.click(screen.getByText('Outside'));

    expect(panel()).toBeNull();
    expect(onApply).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Filter Source, Beta' })).toBeVisible();
  });

  it('closes with Escape and with its close button', async () => {
    render(<Filter onApply={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Filter Source' }));
    await userEvent.keyboard('{Escape}');
    expect(panel()).toBeNull();

    await userEvent.click(screen.getByRole('button', { name: 'Filter Source' }));
    await userEvent.click(within(panel()!).getByRole('button', { name: 'Close filter' }));
    expect(panel()).toBeNull();
  });
});

const fields = [
  { value: 'word', label: 'Word' },
  { value: 'next', label: 'Next' },
] as const;

function Sort() {
  const [field, setField] = useState<'word' | 'next'>('word');
  const [direction, setDirection] = useState<SortDirection>('asc');
  return (
    <SortControl
      fields={fields}
      field={field}
      direction={direction}
      onField={setField}
      onDirection={setDirection}
    />
  );
}

describe('SortControl', () => {
  it('takes a field and a direction as soon as they are chosen', async () => {
    render(<Sort />);

    await userEvent.click(screen.getByRole('button', { name: 'Sort by Word, ascending' }));
    const sort = screen.getByRole('dialog', { name: 'Sort' });
    expect(within(sort).getByRole('radio', { name: 'Word' })).toBeChecked();
    expect(within(sort).getByRole('button', { name: 'Ascending' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(sort).getByRole('radio', { name: 'Next' }));
    await userEvent.click(within(sort).getByRole('button', { name: 'Descending' }));

    expect(within(sort).getByRole('button', { name: 'Descending' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(within(sort).getByRole('button', { name: 'Close sort' }));
    expect(screen.getByRole('button', { name: 'Sort by Next, descending' })).toBeVisible();
  });
});
