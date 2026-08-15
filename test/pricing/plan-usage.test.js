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

test('goat and pro consume identical allowance at peak and off-peak', () => {
  for (const plan of ['goat', 'pro']) {
    const offPeak = meterUsage({ plan, model: 'deepseek-v4-flash', usage: USAGE, at: utc(12) });
    const peak = meterUsage({ plan, model: 'deepseek-v4-flash', usage: USAGE, at: utc(7) });

    assert.equal(offPeak.tier, PricingTier.OFF_PEAK);
    assert.equal(peak.tier, PricingTier.PEAK);
    // Same usage deduction regardless of time of day.
    assert.equal(peak.planUsageUsd, offPeak.planUsageUsd);
    // Plan users are never billed extra for peak.
    assert.equal(peak.billedUsd, 0);
    assert.equal(offPeak.billedUsd, 0);
  }
});

test('peak surcharge is absorbed and equals the provider premium', () => {
  const peak = meterUsage({ plan: 'goat', model: 'deepseek-v4-pro', usage: USAGE, at: utc(2) });
  assert.equal(peak.providerCostUsd, peak.planUsageUsd * 2);
  assert.equal(peak.peakSurchargeUsd, peak.providerCostUsd - peak.planUsageUsd);
});

test('no surcharge is recorded off-peak', () => {
  const offPeak = meterUsage({ plan: 'pro', model: 'deepseek-v4-pro', usage: USAGE, at: utc(14) });
  assert.equal(offPeak.peakSurchargeUsd, 0);
  assert.equal(offPeak.providerCostUsd, offPeak.planUsageUsd);
});

test('pay-as-you-go pays the dynamic peak price directly', () => {
  const peak = meterUsage({ plan: 'payg', model: 'deepseek-v4-flash', usage: USAGE, at: utc(8) });
  const offPeak = meterUsage({ plan: 'payg', model: 'deepseek-v4-flash', usage: USAGE, at: utc(12) });

  assert.equal(peak.billedUsd, peak.providerCostUsd);
  assert.equal(peak.billedUsd, offPeak.billedUsd * 2);
  assert.equal(peak.planUsageUsd, 0);
  assert.equal(peak.peakSurchargeUsd, 0);
});

test('plan metering before the cutover uses the legacy flat rates', () => {
  const at = new Date(Date.UTC(2026, 7, 16, 2)); // pre-cutover, inside future peak window
  const result = meterUsage({ plan: 'goat', model: 'deepseek-v4-flash', usage: USAGE, at });
  assert.equal(result.tier, PricingTier.FLAT);
  assert.equal(result.peakSurchargeUsd, 0);
  assert.equal(result.providerCostUsd, result.planUsageUsd);
});

test('unknown plans throw', () => {
  assert.throws(
    () => meterUsage({ plan: 'free', model: 'deepseek-v4-flash', usage: USAGE, at: utc(12) }),
    RangeError,
  );
});

test('plan registry flags who absorbs the surcharge', () => {
  assert.equal(PLANS.goat.absorbsPeakSurcharge, true);
  assert.equal(PLANS.pro.absorbsPeakSurcharge, true);
  assert.equal(PLANS.payg.absorbsPeakSurcharge, false);
});
