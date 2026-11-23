'use client';

// The search box above a list (.docs/design/screens.md, 输入框): the text field, whose
// placeholder is also its accessible name, and the search button. Enter or the button submits the
// text without the spaces at its ends; the field takes no more than its maximum of characters.
import { useState } from 'react';
import { Icon } from './icon.tsx';
import { buttonClassName } from './button.tsx';

export type SearchBoxProps = {
  placeholder: string;
  maxLength: number;
  /** The search that applies now; the field starts with it. */
  value: string;
  onSearch: (text: string) => void;
};

export function SearchBox({ placeholder, maxLength, value, onSearch }: SearchBoxProps) {
  const [text, setText] = useState(value);
  return (
    <form
      role="search"
      className="flex flex-[1_1_100%] gap-[5px]"
      onSubmit={(event) => {
        event.preventDefault();
        onSearch(text.trim());
      }}
    >
      <input
        aria-label={placeholder}
        placeholder={placeholder}
        enterKeyHint="search"
        maxLength={maxLength}
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="min-h-11 w-full min-w-0 rounded border border-line bg-surface px-[7px] py-[5px] text-base"
      />
      <button type="submit" className={buttonClassName('default', 'icon')} aria-label="Search">
        <Icon name="search" />
      </button>
    </form>
  );
}
