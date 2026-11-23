import { describe, expect, it, vi } from 'vitest';
import { currentLookup, provideLookup, provideWordSaver } from './lookup-bridge.ts';

function bridge() {
  return { lookUp: vi.fn(), openSelectionTool: vi.fn() };
}

describe('provideLookup', () => {
  it('makes the bridge current until it is taken away', () => {
    expect(currentLookup()).toBeNull();
    const provided = bridge();

    const remove = provideLookup(provided);
    expect(currentLookup()).toBe(provided);

    remove();
    expect(currentLookup()).toBeNull();
  });

  it('keeps a newer bridge when an older one is taken away', () => {
    const removeOlder = provideLookup(bridge());
    const newer = bridge();
    const removeNewer = provideLookup(newer);

    removeOlder();

    expect(currentLookup()).toBe(newer);
    removeNewer();
  });
});

describe('provideWordSaver', () => {
  it('keeps the saver apart from the bridge', () => {
    const remove = provideWordSaver(async () => 'card');

    expect(currentLookup()).toBeNull();
    remove();
  });
});
