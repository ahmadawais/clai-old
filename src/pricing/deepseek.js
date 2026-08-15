/**
 * DeepSeek model pricing, including the peak/off-peak schedule that takes
 * effect on 2026-08-16 at 16:00 UTC.
 *
 * Source: https://api-docs.deepseek.com/quick_start/pricing/
 *
 * Peak windows (daily, UTC): 01:00–04:00 and 06:00–10:00.
 * Peak rates are 2x the off-peak rates. Before the cutover instant the old
 * flat rates apply around the clock.
 *
 * All rates are USD per 1 million tokens.
 */

/** Instant at which the peak/off-peak schedule replaces the flat rates. */
export const PEAK_PRICING_EFFECTIVE_AT = new Date(Date.UTC(2026, 7, 16, 16, 0, 0));

/** Daily peak windows in UTC. Each window covers [startHour, endHour). */
export const PEAK_WINDOWS_UTC = Object.freeze([
  Object.freeze({ startHour: 1, endHour: 4 }),
  Object.freeze({ startHour: 6, endHour: 10 }),
]);

/** Peak rates are this multiple of the off-peak rates. */
export const PEAK_MULTIPLIER = 2;

/** Pricing tiers returned by getRates(). */
export const PricingTier = Object.freeze({
  /** Flat legacy pricing, before the 2026-08-16 16:00 UTC cutover. */
  FLAT: 'flat',
  OFF_PEAK: 'off-peak',
  PEAK: 'peak',
});

/**
 * Legacy aliases still accepted by the API surface. DeepSeek retired
 * deepseek-chat / deepseek-reasoner as model IDs on 2026-07-24; both were
 * aliases of deepseek-v4-flash (non-thinking / thinking modes).
 */
const MODEL_ALIASES = Object.freeze({
  'deepseek-chat': 'deepseek-v4-flash',
  'deepseek-reasoner': 'deepseek-v4-flash',
});

/**
 * USD per 1M tokens.
 * - flat: rates in effect until PEAK_PRICING_EFFECTIVE_AT.
 * - offPeak: rates outside the peak windows from the cutover onward.
 *   Peak rates are always offPeak * PEAK_MULTIPLIER.
 */
const MODEL_RATES = Object.freeze({
  'deepseek-v4-flash': Object.freeze({
    flat: Object.freeze({ cacheHitInput: 0.0028, cacheMissInput: 0.14, output: 0.28 }),
    offPeak: Object.freeze({ cacheHitInput: 0.007, cacheMissInput: 0.22, output: 0.66 }),
  }),
  'deepseek-v4-pro': Object.freeze({
    flat: Object.freeze({ cacheHitInput: 0.003625, cacheMissInput: 0.435, output: 0.87 }),
    offPeak: Object.freeze({ cacheHitInput: 0.022, cacheMissInput: 0.66, output: 1.98 }),
  }),
});

/** Canonical model IDs with pricing data. */
export const PRICED_MODELS = Object.freeze(Object.keys(MODEL_RATES));

/**
 * Resolve a model name (including legacy aliases) to its canonical ID.
 * Throws on models with no pricing data so charges never silently
 * default to zero.
 */
export function resolveModel(model) {
  const canonical = MODEL_ALIASES[model] ?? model;
  if (!Object.hasOwn(MODEL_RATES, canonical)) {
    throw new RangeError(`No DeepSeek pricing data for model "${model}"`);
  }
  return canonical;
}

/**
 * Whether peak pricing applies at the given instant. Always false before
 * the schedule's effective date.
 */
export function isPeakTime(at) {
  const ts = toDate(at);
  if (ts < PEAK_PRICING_EFFECTIVE_AT) return false;
  const hour = ts.getUTCHours();
  return PEAK_WINDOWS_UTC.some((w) => hour >= w.startHour && hour < w.endHour);
}

/**
 * Rates in force for a model at an instant.
 *
 * @returns {{ tier: string, rates: { cacheHitInput: number, cacheMissInput: number, output: number } }}
 */
export function getRates(model, at) {
  const canonical = resolveModel(model);
  const ts = toDate(at);
  const { flat, offPeak } = MODEL_RATES[canonical];

  if (ts < PEAK_PRICING_EFFECTIVE_AT) {
    return { tier: PricingTier.FLAT, rates: flat };
  }
  if (isPeakTime(ts)) {
    return {
      tier: PricingTier.PEAK,
      rates: scaleRates(offPeak, PEAK_MULTIPLIER),
    };
  }
  return { tier: PricingTier.OFF_PEAK, rates: offPeak };
}

/**
 * Rates used for plan-allowance metering: time-of-day independent, so a
 * request consumes the same allowance whether it runs at peak or not.
 * Flat rates before the cutover, off-peak rates after it.
 */
export function getBaseRates(model, at) {
  const canonical = resolveModel(model);
  const ts = toDate(at);
  const { flat, offPeak } = MODEL_RATES[canonical];
  return ts < PEAK_PRICING_EFFECTIVE_AT
    ? { tier: PricingTier.FLAT, rates: flat }
    : { tier: PricingTier.OFF_PEAK, rates: offPeak };
}

/**
 * Cost in USD of a single usage record at the rates in force at `at`.
 *
 * @param {string} model
 * @param {{ cacheHitInputTokens?: number, cacheMissInputTokens?: number, outputTokens?: number }} usage
 * @param {Date | number | string} at
 * @returns {{ tier: string, costUsd: number, rates: object }}
 */
export function calculateCharge(model, usage, at) {
  const { tier, rates } = getRates(model, at);
  return { tier, rates, costUsd: costUsd(usage, rates) };
}

/** Cost in USD for a usage record at a given per-1M-token rate card. */
export function costUsd(usage, rates) {
  const cacheHit = tokenCount(usage.cacheHitInputTokens, 'cacheHitInputTokens');
  const cacheMiss = tokenCount(usage.cacheMissInputTokens, 'cacheMissInputTokens');
  const output = tokenCount(usage.outputTokens, 'outputTokens');
  const raw =
    (cacheHit * rates.cacheHitInput + cacheMiss * rates.cacheMissInput + output * rates.output) /
    1_000_000;
  return roundUsd(raw);
}

/** Round to micro-dollar precision to keep sums stable. */
export function roundUsd(value) {
  return Math.round(value * 1e6) / 1e6;
}

function scaleRates(rates, factor) {
  return {
    cacheHitInput: rates.cacheHitInput * factor,
    cacheMissInput: rates.cacheMissInput * factor,
    output: rates.output * factor,
  };
}

function tokenCount(value, field) {
  if (value === undefined || value === null) return 0;
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${field} must be a non-negative finite number, got ${value}`);
  }
  return value;
}

function toDate(at) {
  const ts = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(ts.getTime())) {
    throw new RangeError(`Invalid timestamp: ${at}`);
  }
  return ts;
}
