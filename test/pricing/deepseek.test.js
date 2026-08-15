import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PEAK_PRICING_EFFECTIVE_AT,
  PEAK_WINDOWS_UTC,
  PricingTier,
  calculateCharge,
  getBaseRates,
  getRates,
  isPeakTime,
  resolveModel,
} from '../../src/pricing/deepseek.js';

const utc = (y, mo, d, h, mi = 0) => new Date(Date.UTC(y, mo - 1, d, h, mi));

// A day safely after the cutover.
const AFTER = (h, mi = 0) => utc(2026, 8, 20, h, mi);

test('cutover instant is 2026-08-16 16:00 UTC', () => {
  assert.equal(PEAK_PRICING_EFFECTIVE_AT.toISOString(), '2026-08-16T16:00:00.000Z');
});

test('peak windows are 01:00–04:00 and 06:00–10:00 UTC', () => {
  assert.deepEqual(
    PEAK_WINDOWS_UTC.map((w) => [w.startHour, w.endHour]),
    [
      [1, 4],
      [6, 10],
    ],
  );
});

test('isPeakTime respects window boundaries (half-open intervals)', () => {
  assert.equal(isPeakTime(AFTER(0, 59)), false);
  assert.equal(isPeakTime(AFTER(1, 0)), true);
  assert.equal(isPeakTime(AFTER(3, 59)), true);
  assert.equal(isPeakTime(AFTER(4, 0)), false);
  assert.equal(isPeakTime(AFTER(5, 59)), false);
  assert.equal(isPeakTime(AFTER(6, 0)), true);
  assert.equal(isPeakTime(AFTER(9, 59)), true);
  assert.equal(isPeakTime(AFTER(10, 0)), false);
  assert.equal(isPeakTime(AFTER(16, 30)), false);
});

test('no peak pricing before the cutover, even inside a peak window', () => {
  // 02:00 UTC on Aug 16 is inside a peak window but before the 16:00 cutover.
  assert.equal(isPeakTime(utc(2026, 8, 16, 2)), false);
  const { tier, rates } = getRates('deepseek-v4-flash', utc(2026, 8, 16, 2));
  assert.equal(tier, PricingTier.FLAT);
  assert.deepEqual(rates, { cacheHitInput: 0.0028, cacheMissInput: 0.14, output: 0.28 });
});

test('off-peak rates apply right after the cutover (outside peak windows)', () => {
  const { tier, rates } = getRates('deepseek-v4-flash', utc(2026, 8, 16, 17));
  assert.equal(tier, PricingTier.OFF_PEAK);
  assert.deepEqual(rates, { cacheHitInput: 0.007, cacheMissInput: 0.22, output: 0.66 });
});

test('peak rates are exactly 2x off-peak for v4-flash', () => {
  const { tier, rates } = getRates('deepseek-v4-flash', AFTER(7));
  assert.equal(tier, PricingTier.PEAK);
  assert.deepEqual(rates, { cacheHitInput: 0.014, cacheMissInput: 0.44, output: 1.32 });
});

test('peak rates are exactly 2x off-peak for v4-pro', () => {
  const { tier, rates } = getRates('deepseek-v4-pro', AFTER(2));
  assert.equal(tier, PricingTier.PEAK);
  assert.deepEqual(rates, { cacheHitInput: 0.044, cacheMissInput: 1.32, output: 3.96 });
});

test('legacy flat rates for v4-pro before cutover', () => {
  const { tier, rates } = getRates('deepseek-v4-pro', utc(2026, 8, 10, 12));
  assert.equal(tier, PricingTier.FLAT);
  assert.deepEqual(rates, { cacheHitInput: 0.003625, cacheMissInput: 0.435, output: 0.87 });
});

test('legacy aliases resolve to v4-flash', () => {
  assert.equal(resolveModel('deepseek-chat'), 'deepseek-v4-flash');
  assert.equal(resolveModel('deepseek-reasoner'), 'deepseek-v4-flash');
  assert.deepEqual(getRates('deepseek-chat', AFTER(12)), getRates('deepseek-v4-flash', AFTER(12)));
});

test('unknown models throw instead of pricing at zero', () => {
  assert.throws(() => resolveModel('deepseek-v9-mega'), RangeError);
  assert.throws(() => getRates('gpt-4o', AFTER(12)), RangeError);
});

test('calculateCharge: off-peak v4-flash cost math', () => {
  const usage = { cacheHitInputTokens: 1_000_000, cacheMissInputTokens: 1_000_000, outputTokens: 1_000_000 };
  const { tier, costUsd } = calculateCharge('deepseek-v4-flash', usage, AFTER(12));
  assert.equal(tier, PricingTier.OFF_PEAK);
  assert.equal(costUsd, 0.007 + 0.22 + 0.66);
});

test('calculateCharge: peak doubles the cost of the same request', () => {
  const usage = { cacheHitInputTokens: 250_000, cacheMissInputTokens: 500_000, outputTokens: 100_000 };
  const offPeak = calculateCharge('deepseek-v4-pro', usage, AFTER(12));
  const peak = calculateCharge('deepseek-v4-pro', usage, AFTER(8));
  assert.equal(peak.costUsd, offPeak.costUsd * 2);
});

test('calculateCharge treats missing token fields as zero', () => {
  const { costUsd } = calculateCharge('deepseek-v4-flash', { outputTokens: 2_000_000 }, AFTER(12));
  assert.equal(costUsd, 1.32);
});

test('negative or non-finite token counts throw', () => {
  assert.throws(
    () => calculateCharge('deepseek-v4-flash', { outputTokens: -1 }, AFTER(12)),
    RangeError,
  );
  assert.throws(
    () => calculateCharge('deepseek-v4-flash', { outputTokens: Number.NaN }, AFTER(12)),
    RangeError,
  );
});

test('invalid timestamps throw', () => {
  assert.throws(() => getRates('deepseek-v4-flash', 'not-a-date'), RangeError);
});

test('getBaseRates never returns peak pricing', () => {
  const duringPeak = getBaseRates('deepseek-v4-pro', AFTER(2));
  assert.equal(duringPeak.tier, PricingTier.OFF_PEAK);
  assert.deepEqual(duringPeak.rates, { cacheHitInput: 0.022, cacheMissInput: 0.66, output: 1.98 });

  const beforeCutover = getBaseRates('deepseek-v4-pro', utc(2026, 8, 1, 2));
  assert.equal(beforeCutover.tier, PricingTier.FLAT);
});
