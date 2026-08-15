import test from 'node:test';
import assert from 'node:assert/strict';

import { PLANS, meterUsage } from '../../src/pricing/plan-usage.js';
import { PricingTier } from '../../src/pricing/deepseek.js';

const utc = (h, mi = 0) => new Date(Date.UTC(2026, 7, 20, h, mi));

const USAGE = {
  cacheHitInputTokens: 400_000,
  cacheMissInputTokens: 300_000,
  outputTokens: 200_000,
};

test('goat and pro allowances deduct at the dynamic rate: peak burns 2x', () => {
  for (const plan of ['goat', 'pro']) {
    const offPeak = meterUsage({ plan, model: 'deepseek-v4-flash', usage: USAGE, at: utc(12) });
    const peak = meterUsage({ plan, model: 'deepseek-v4-flash', usage: USAGE, at: utc(7) });

    assert.equal(offPeak.tier, PricingTier.OFF_PEAK);
    assert.equal(peak.tier, PricingTier.PEAK);
    // Peak premium is passed through: the same request costs double allowance.
    assert.equal(peak.planUsageUsd, offPeak.planUsageUsd * 2);
    // Allowance plans are never billed directly.
    assert.equal(peak.billedUsd, 0);
    assert.equal(offPeak.billedUsd, 0);
  }
});

test('goat and pro are treated identically', () => {
  const goat = meterUsage({ plan: 'goat', model: 'deepseek-v4-pro', usage: USAGE, at: utc(2) });
  const pro = meterUsage({ plan: 'pro', model: 'deepseek-v4-pro', usage: USAGE, at: utc(2) });
  assert.deepEqual({ ...goat, plan: null }, { ...pro, plan: null });
});

test('nothing is absorbed: allowance deduction always covers provider cost', () => {
  for (const at of [utc(2), utc(7), utc(12), utc(23)]) {
    const result = meterUsage({ plan: 'goat', model: 'deepseek-v4-pro', usage: USAGE, at });
    assert.equal(result.planUsageUsd, result.providerCostUsd);
  }
});

test('peak premium is reported as the peak-attributable portion of the charge', () => {
  const peak = meterUsage({ plan: 'pro', model: 'deepseek-v4-pro', usage: USAGE, at: utc(2) });
  assert.equal(peak.peakPremiumUsd, peak.providerCostUsd / 2);

  const offPeak = meterUsage({ plan: 'pro', model: 'deepseek-v4-pro', usage: USAGE, at: utc(14) });
  assert.equal(offPeak.peakPremiumUsd, 0);
});

test('pay-as-you-go pays the dynamic peak price directly', () => {
  const peak = meterUsage({ plan: 'payg', model: 'deepseek-v4-flash', usage: USAGE, at: utc(8) });
  const offPeak = meterUsage({ plan: 'payg', model: 'deepseek-v4-flash', usage: USAGE, at: utc(12) });

  assert.equal(peak.billedUsd, peak.providerCostUsd);
  assert.equal(peak.billedUsd, offPeak.billedUsd * 2);
  assert.equal(peak.planUsageUsd, 0);
});

test('plan metering before the cutover uses the legacy flat rates', () => {
  const at = new Date(Date.UTC(2026, 7, 16, 2)); // pre-cutover, inside future peak window
  const result = meterUsage({ plan: 'goat', model: 'deepseek-v4-flash', usage: USAGE, at });
  assert.equal(result.tier, PricingTier.FLAT);
  assert.equal(result.peakPremiumUsd, 0);
  assert.equal(result.planUsageUsd, result.providerCostUsd);
});

test('unknown plans throw', () => {
  assert.throws(
    () => meterUsage({ plan: 'free', model: 'deepseek-v4-flash', usage: USAGE, at: utc(12) }),
    RangeError,
  );
});

test('plan registry declares billing modes', () => {
  assert.equal(PLANS.goat.billing, 'allowance');
  assert.equal(PLANS.pro.billing, 'allowance');
  assert.equal(PLANS.payg.billing, 'direct');
});
