/**
 * Plan-aware metering for DeepSeek charges under the peak/off-peak schedule.
 *
 * Product requirement: provider charges are priced dynamically during peak
 * hours, but Goat and Pro subscribers keep the same usage allowance around
 * the clock. We achieve that by always metering plan allowances at the
 * time-of-day-independent base (off-peak) rates; the peak premium is
 * absorbed by us and tracked separately as `peakSurchargeUsd` for internal
 * cost accounting. Pay-as-you-go usage is billed at the dynamic rate in
 * force when the request runs.
 */

import { calculateCharge, costUsd, getBaseRates, roundUsd } from './deepseek.js';

export const PLANS = Object.freeze({
  goat: Object.freeze({ id: 'goat', name: 'Goat', absorbsPeakSurcharge: true }),
  pro: Object.freeze({ id: 'pro', name: 'Pro', absorbsPeakSurcharge: true }),
  payg: Object.freeze({ id: 'payg', name: 'Pay as you go', absorbsPeakSurcharge: false }),
});

/**
 * Meter one usage record against a plan.
 *
 * @param {{ plan: string, model: string, usage: object, at: Date | number | string }} params
 * @returns {{
 *   plan: string,
 *   tier: string,                    // pricing tier in force when the request ran
 *   providerCostUsd: number,         // what DeepSeek charges us (dynamic)
 *   planUsageUsd: number,            // what we deduct from the user's allowance
 *   billedUsd: number,               // what the user pays on top of the plan (PAYG only)
 *   peakSurchargeUsd: number,        // peak premium we absorb for plan users
 * }}
 */
export function meterUsage({ plan, model, usage, at }) {
  const planDef = PLANS[plan];
  if (!planDef) {
    throw new RangeError(`Unknown plan "${plan}"`);
  }

  const provider = calculateCharge(model, usage, at);
  const base = getBaseRates(model, at);
  const baseCostUsd = costUsd(usage, base.rates);

  if (planDef.absorbsPeakSurcharge) {
    return {
      plan: planDef.id,
      tier: provider.tier,
      providerCostUsd: provider.costUsd,
      planUsageUsd: baseCostUsd,
      billedUsd: 0,
      peakSurchargeUsd: roundUsd(provider.costUsd - baseCostUsd),
    };
  }

  return {
    plan: planDef.id,
    tier: provider.tier,
    providerCostUsd: provider.costUsd,
    planUsageUsd: 0,
    billedUsd: provider.costUsd,
    peakSurchargeUsd: 0,
  };
}
