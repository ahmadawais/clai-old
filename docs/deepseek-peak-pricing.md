# DeepSeek peak-hour pricing

DeepSeek replaces its flat API rates with a peak/off-peak schedule at
**16:00 UTC on 2026-08-16** ([official pricing page](https://api-docs.deepseek.com/quick_start/pricing/)).

## Schedule

- **Peak windows (daily, UTC):** 01:00–04:00 and 06:00–10:00
- **Off-peak:** all other hours
- **Peak rates = 2× off-peak rates**
- Before the cutover instant, the old flat rates apply around the clock —
  including inside the future peak windows on Aug 16 itself.

## Rates (USD per 1M tokens)

| Model | Tier | Cache-hit input | Cache-miss input | Output |
| --- | --- | --- | --- | --- |
| deepseek-v4-flash | flat (pre-cutover) | $0.0028 | $0.14 | $0.28 |
| deepseek-v4-flash | off-peak | $0.007 | $0.22 | $0.66 |
| deepseek-v4-flash | peak | $0.014 | $0.44 | $1.32 |
| deepseek-v4-pro | flat (pre-cutover) | $0.003625 | $0.435 | $0.87 |
| deepseek-v4-pro | off-peak | $0.022 | $0.66 | $1.98 |
| deepseek-v4-pro | peak | $0.044 | $1.32 | $3.96 |

The retired `deepseek-chat` and `deepseek-reasoner` model IDs are accepted as
aliases of `deepseek-v4-flash`.

## How Command Code plans handle it

Provider charges are computed dynamically (`src/pricing/deepseek.js`), but
**Goat and Pro subscribers keep the same usage allowance at all hours**:

- Plan allowances are metered at the time-independent base (off-peak) rates
  via `getBaseRates()`, so a request consumes the same allowance at 07:00 UTC
  as at 15:00 UTC.
- The peak premium is absorbed by us and surfaced as `peakSurchargeUsd` in
  `meterUsage()` (`src/pricing/plan-usage.js`) for internal cost accounting.
- Pay-as-you-go usage is billed at the dynamic rate in force when the
  request runs.
