import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { AccountMenu } from './account-menu.tsx';

afterEach(() => {
  cleanup();
});

function renderMenu() {
  const actions = { onOpenTerms: vi.fn(), onOpenLicense: vi.fn(), onLogOut: vi.fn() };
  render(
    <div>
      <p>Outside</p>
      <AccountMenu initials="AC" {...actions} />
    </div>,
  );
  return actions;
}

const avatar = () => screen.getByRole('button', { name: 'Account menu' });
const menu = () => screen.queryByRole('dialog', { name: 'Account' });

describe('AccountMenu', () => {
  it('shows the initials and opens Terms, License and Log out', async () => {
    renderMenu();
    expect(avatar()).toHaveTextContent('AC');
    expect(avatar()).toHaveAttribute('aria-expanded', 'false');

    await userEvent.click(avatar());

    expect(avatar()).toHaveAttribute('aria-expanded', 'true');
    expect([...(menu()?.querySelectorAll('button') ?? [])].map((b) => b.textContent)).toEqual([
      'Terms',
      'License',
      'Log out',
    ]);
  });

  it.each([
    ['Terms', 'onOpenTerms'],
    ['License', 'onOpenLicense'],
    ['Log out', 'onLogOut'],
  ] as const)('runs %s and closes the menu', async (item, action) => {
    const actions = renderMenu();
    await userEvent.click(avatar());

    await userEvent.click(screen.getByRole('button', { name: item }));

    expect(actions[action]).toHaveBeenCalledOnce();
    expect(menu()).toBeNull();
  });

  it('closes when the person presses outside it', async () => {
    const actions = renderMenu();
    await userEvent.click(avatar());

    await userEvent.click(screen.getByText('Outside'));

    expect(menu()).toBeNull();
    expect(actions.onLogOut).not.toHaveBeenCalled();
  });

  it('closes with Escape and when the avatar is pressed again', async () => {
    renderMenu();
    await userEvent.click(avatar());
    await userEvent.keyboard('{Escape}');
    expect(menu()).toBeNull();

    await userEvent.click(avatar());
    await userEvent.click(avatar());
    expect(menu()).toBeNull();
  });
});
