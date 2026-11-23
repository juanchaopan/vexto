import { describe, expect, it } from 'vitest';
import { estimateCost, formatMicroDollars, type Price } from './cost.ts';

const tokens: Price = {
  unit: 'tokens',
  usdPerMillionInputTokens: '0.10',
  usdPerMillionOutputTokens: '0.50',
};

const cpu: Price = { unit: 'cpu-seconds', usdPerCpuSecond: '0.000024' };

describe('estimateCost', () => {
  it('prices input and output tokens per million', () => {
    // 812 × 0.10 / 10^6 + 96 × 0.50 / 10^6 = 0.0000812 + 0.000048 = 0.0001292
    expect(estimateCost(tokens, { inputTokens: 812, outputTokens: 96 })).toBe('0.000129');
    expect(estimateCost(tokens, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(
      '0.600000',
    );
  });

  it('rounds the sixth place half up', () => {
    // 5 × 0.10 / 10^6 = 0.0000005, half a micro-dollar
    expect(estimateCost(tokens, { inputTokens: 5, outputTokens: 0 })).toBe('0.000001');
    expect(estimateCost(tokens, { inputTokens: 4, outputTokens: 0 })).toBe('0.000000');
  });

  it('prices CPU time per second', () => {
    // 680 000 ms = 680 s × 0.000024 = 0.01632
    expect(estimateCost(cpu, { cpuMs: 680_000 })).toBe('0.016320');
    expect(estimateCost({ unit: 'cpu-seconds', usdPerCpuSecond: '0' }, { cpuMs: 75 })).toBe(
      '0.000000',
    );
  });

  it('gives no estimate when the usage the price needs is unknown', () => {
    expect(estimateCost(tokens, { inputTokens: 10 })).toBeUndefined();
    expect(estimateCost(tokens, { inputTokens: null, outputTokens: 3 })).toBeUndefined();
    expect(estimateCost(cpu, { inputTokens: 10, outputTokens: 3 })).toBeUndefined();
  });

  it('keeps large amounts exact', () => {
    const price: Price = {
      unit: 'tokens',
      usdPerMillionInputTokens: '123.456789012345',
      usdPerMillionOutputTokens: '0',
    };
    expect(estimateCost(price, { inputTokens: 2_000_000_000, outputTokens: 0 })).toBe(
      '246913.578025',
    );
  });

  it('refuses a price that is not a decimal amount', () => {
    const price: Price = { ...tokens, usdPerMillionInputTokens: '1e-3' };
    expect(() => estimateCost(price, { inputTokens: 1, outputTokens: 1 })).toThrow(
      'not a decimal amount',
    );
  });
});

describe('formatMicroDollars', () => {
  it('writes six decimal places', () => {
    expect(formatMicroDollars(BigInt(0))).toBe('0.000000');
    expect(formatMicroDollars(BigInt(420))).toBe('0.000420');
    expect(formatMicroDollars(BigInt(12_345_678))).toBe('12.345678');
  });
});
