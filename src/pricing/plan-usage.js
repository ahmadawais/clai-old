/**
 * Plan-aware metering for DeepSeek charges under the peak/off-peak schedule.
 *
 * Product requirement: the peak premium is passed through to customers, not
 * absorbed by us. Goat and Pro are treated identically: plan allowances are
 * metered at the dynamic rate in force when the request runs, so the same
 * request consumes twice the allowance during peak hours (peak = 2x
 * off-peak). Pay-as-you-go usage is billed directly at the same dynamic
 * rate. `peakPremiumUsd` reports the portion of the charge attributable to
 * peak pricing, for receipts and usage breakdowns.
 */

import { calculateCharge, costUsd, getBaseRates, roundUsd } from './deepseek.js';

export const PLANS = Object.freeze({
  goat: Object.freeze({ id: 'goat', name: 'Goat', billing: 'allowance' }),
  pro: Object.freeze({ id: 'pro', name: 'Pro', billing: 'allowance' }),
  payg: Object.freeze({ id: 'payg', name: 'Pay as you go', billing: 'direct' }),
});

/**
 * Meter one usage record against a plan.
 *
 * @param {{ plan: string, model: string, usage: object, at: Date | number | string }} params
 * @returns {{
 *   plan: string,
 *   tier: string,            // pricing tier in force when the request ran
 *   providerCostUsd: number, // what DeepSeek charges us (dynamic)
 *   planUsageUsd: number,    // deducted from the plan allowance (dynamic; 0 for direct billing)
 *   billedUsd: number,       // charged directly to the customer (0 for allowance plans)
 *   peakPremiumUsd: number,  // portion of the charge attributable to peak pricing
 * }}
 */
export function meterUsage({ plan, model, usage, at }) {
  const planDef = PLANS[plan];
  if (!planDef) {
    throw new RangeError(`Unknown plan "${plan}"`);
  }

  const provider = calculateCharge(model, usage, at);
  const base = getBaseRates(model, at);
  const peakPremiumUsd = roundUsd(provider.costUsd - costUsd(usage, base.rates));

  return {
    plan: planDef.id,
    tier: provider.tier,
    providerCostUsd: provider.costUsd,
    planUsageUsd: planDef.billing === 'allowance' ? provider.costUsd : 0,
    billedUsd: planDef.billing === 'direct' ? provider.costUsd : 0,
    peakPremiumUsd,
  };
}
