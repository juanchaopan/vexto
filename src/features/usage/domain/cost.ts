// The estimated cost of one call (.docs/design/rules.md, 用量记录): the usage it reported times the
// price of its model, as a decimal number of dollars with six places, the precision of
// `usage_records.estimated_cost`. Amounts are worked out in integers, never in floats; the last
// place is rounded half up. A cost needs every usage its price counts: unknown usage gives no
// estimate rather than an estimate of nothing.

/** Dollars per million input and output tokens, as decimal strings. */
export type TokenPrice = {
  unit: 'tokens';
  usdPerMillionInputTokens: string;
  usdPerMillionOutputTokens: string;
};

/** Dollars per second of CPU time, as a decimal string. */
export type CpuPrice = { unit: 'cpu-seconds'; usdPerCpuSecond: string };

export type Price = TokenPrice | CpuPrice;

export type MeteredUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cpuMs?: number | null;
};

const PRICE_PLACES = 12;
const PRICE_SCALE = BigInt(10) ** BigInt(PRICE_PLACES);
const MICRO = BigInt(1_000_000);
const THOUSAND = BigInt(1000);
const TWO = BigInt(2);

/** A decimal amount as an integer count of 10^-12 dollars. */
function scaledPrice(amount: string): bigint {
  const match = /^(\d+)(?:\.(\d{1,12}))?$/.exec(amount);
  if (!match) {
    throw new Error(`"${amount}" is not a decimal amount of dollars.`);
  }
  return BigInt(match[1]) * PRICE_SCALE + BigInt((match[2] ?? '').padEnd(PRICE_PLACES, '0'));
}

function count(value: number | null | undefined): bigint | undefined {
  return value === null || value === undefined || !Number.isInteger(value) || value < 0
    ? undefined
    : BigInt(value);
}

/** `numerator / divisor` rounded half up, for non-negative integers. */
function roundedDivision(numerator: bigint, divisor: bigint): bigint {
  return (numerator + divisor / TWO) / divisor;
}

/** Micro-dollars as a decimal string with six places, such as "0.000420". */
export function formatMicroDollars(micro: bigint): string {
  return `${micro / MICRO}.${(micro % MICRO).toString().padStart(6, '0')}`;
}

function tokenCost(price: TokenPrice, usage: MeteredUsage): bigint | undefined {
  const input = count(usage.inputTokens);
  const output = count(usage.outputTokens);
  if (input === undefined || output === undefined) {
    return undefined;
  }
  // Tokens × 10^-12 dollars per million tokens: divide by 10^6 for the million and 10^6 more to
  // go from 10^-12 to 10^-6 dollars.
  const total =
    input * scaledPrice(price.usdPerMillionInputTokens) +
    output * scaledPrice(price.usdPerMillionOutputTokens);
  return roundedDivision(total, MICRO * MICRO);
}

function cpuCost(price: CpuPrice, usage: MeteredUsage): bigint | undefined {
  const cpuMs = count(usage.cpuMs);
  if (cpuMs === undefined) {
    return undefined;
  }
  // Milliseconds × 10^-12 dollars per second: divide by 10^3 for seconds and 10^6 for micro.
  return roundedDivision(cpuMs * scaledPrice(price.usdPerCpuSecond), THOUSAND * MICRO);
}

/** The call's estimated cost in dollars, or undefined when the usage it needs is unknown. */
export function estimateCost(price: Price, usage: MeteredUsage): string | undefined {
  const micro = price.unit === 'tokens' ? tokenCost(price, usage) : cpuCost(price, usage);
  return micro === undefined ? undefined : formatMicroDollars(micro);
}
