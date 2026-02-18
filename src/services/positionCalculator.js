/**
 * positionCalculator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * THE source of truth for all position and P&L calculations.
 *
 * Core principle:
 *   effective_positions = initial_positions + net effect of all transactions
 *
 * Average cost rules:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  CASH ASSETS (USD, THB, USDT, USDC, stablecoins)           │
 *   │  • avg_cost is ALWAYS face value (1.0 for USD)             │
 *   │  • For THB: avg_cost = 1/fx_rate (USD cost of 1 THB)       │
 *   │  • NEVER recalculate on receive — cash is cash             │
 *   │                                                             │
 *   │  NON-CASH ASSETS (stocks, crypto)                          │
 *   │  • avg_cost uses weighted average on BUY                   │
 *   │  • avg_cost does NOT change on SELL                        │
 *   │  • cost_basis reduces proportionally on SELL               │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * Double-entry rules (every trade affects both sides):
 *   Buy  AAPL with $1000 USD  → AAPL qty+, cost_basis+  |  USD qty-, cost_basis-
 *   Sell AAPL for  $1200 USD  → AAPL qty-, cost_basis-  |  USD qty+, cost_basis+ (at face value)
 *   Swap BTC  →   ETH         → BTC  qty-, cost_basis-  |  ETH qty+, cost_basis+ (inherits BTC value)
 *   Deposit   USD             → (no from side)          |  USD qty+, cost_basis+ (face value)
 *   Withdraw  USD             → USD qty-, cost_basis-   |  (no to side)
 *   Transfer  in  stock       → (no from side)          |  Stock qty+, cost_basis+ (at stated avg_cost)
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// CASH ASSET DETECTION
// ─────────────────────────────────────────────────────────────────────────────

const CASH_TICKERS = new Set(['USD', 'THB', 'USDT', 'USDC', 'USDC.E', 'BUSD', 'DAI', 'TUSD', 'FRAX']);

/**
 * Returns true if the ticker represents a cash or stablecoin asset.
 * These assets have a fixed avg_cost (face value) and never use weighted avg.
 */
function isCashAsset(ticker) {
  if (!ticker) return false;
  const upper = ticker.toUpperCase();
  // Direct match
  if (CASH_TICKERS.has(upper)) return true;
  // Pattern match: CASH-USD, CASH-THB, USD-CASH, etc.
  if (upper.startsWith('CASH-') || upper.endsWith('-CASH')) return true;
  // Stablecoins often end in USD
  if (upper.startsWith('USDT') || upper.startsWith('USDC') || upper.startsWith('BUSD')) return true;
  return false;
}

/**
 * Returns true if the ticker is THB-denominated cash.
 * These get special avg_cost treatment (1/fx_rate instead of 1.0).
 */
function isTHBCash(ticker) {
  if (!ticker) return false;
  const upper = ticker.toUpperCase();
  return upper === 'THB' || upper === 'CASH-THB' || upper.endsWith('-THB');
}

/**
 * The face-value avg_cost for a cash asset.
 *   USD → 1.0 (1 dollar costs 1 dollar)
 *   THB → 1/fx_rate (what you paid in USD for 1 THB)
 *
 * @param {string} ticker
 * @param {number} fxRateUSDTHB  Current or transaction-time USD/THB rate
 */
function cashAvgCost(ticker, fxRateUSDTHB = 35.0) {
  if (isTHBCash(ticker)) {
    return 1 / fxRateUSDTHB; // e.g. 1/35 ≈ 0.02857 USD per 1 THB
  }
  return 1.0; // USD stablecoins: 1 USD costs 1 USD
}


// ─────────────────────────────────────────────────────────────────────────────
// POSITION SLOT FACTORY
// ─────────────────────────────────────────────────────────────────────────────

function createPosition(ticker, assetType, costCurrency = 'USD') {
  return {
    ticker,
    asset_type: assetType || 'other',
    quantity: 0,
    avg_cost: 0,        // cost per unit, in cost_currency
    cost_basis: 0,      // total cost = quantity × avg_cost (before any sales reduce it)
    cost_currency: costCurrency,
    realized_pnl: 0,    // running total of locked-in gains from sells/swaps
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// MAIN CALCULATOR
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate effective positions for a user.
 *
 * @param {Array}  initialPositions  Rows from the initial_positions table
 * @param {Array}  transactions      Rows from the transactions table (any order — sorted internally)
 * @param {number} fxRateUSDTHB     Current USD→THB exchange rate (used for cash avg_cost)
 *
 * @returns {Object}  Map of ticker → position object
 */
export function calculatePositions(initialPositions = [], transactions = [], fxRateUSDTHB = 35.0) {
  const positions = {};

  // ── Helper: get or create a position slot ────────────────────────────────
  function getPos(ticker, assetType, costCurrency) {
    if (!positions[ticker]) {
      positions[ticker] = createPosition(ticker, assetType, costCurrency || 'USD');
    }
    // Update asset_type if we get a better value later
    if (assetType && positions[ticker].asset_type === 'other') {
      positions[ticker].asset_type = assetType;
    }
    return positions[ticker];
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 1 — Load initial positions (opening balances, no double-entry)
  // ─────────────────────────────────────────────────────────────────────────
  for (const init of initialPositions) {
    const pos = getPos(init.ticker, init.asset_type, init.cost_currency || 'USD');

    if (isCashAsset(init.ticker)) {
      // Cash: always use face value, never the user-stated avg_cost
      // (If user stated a THB avg_cost it was the fx rate — we recalculate cleanly)
      const faceValue    = cashAvgCost(init.ticker, fxRateUSDTHB);
      pos.quantity       = Number(init.quantity);
      pos.avg_cost       = faceValue;
      pos.cost_basis     = pos.quantity * faceValue;
      pos.cost_currency  = isTHBCash(init.ticker) ? 'USD' : 'USD'; // always store in USD
    } else {
      // Non-cash: accept user-stated avg_cost as-is (they know what they paid)
      pos.quantity       = Number(init.quantity);
      pos.avg_cost       = Number(init.avg_cost) || 0;
      pos.cost_basis     = pos.quantity * pos.avg_cost;
      pos.cost_currency  = init.cost_currency || 'USD';
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 2 — Apply transactions in chronological order
  // ─────────────────────────────────────────────────────────────────────────
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.transaction_date) - new Date(b.transaction_date)
  );

  for (const tx of sorted) {
    const {
      from_ticker,
      from_amount,      // for cash: total dollars/baht spent; for non-cash: units given up
      from_asset_type,
      to_ticker,
      to_amount,        // units received (always)
      to_asset_type,
      fees,
      fee_currency,
      transaction_currency, // 'USD' or 'THB' — the currency the trade was denominated in
      fx_rate_at_time,       // USD/THB rate at tx time (may be null if tx was in USD)
    } = tx;

    // Use the tx-time fx rate if available, otherwise fall back to current
    const txFxRate = Number(fx_rate_at_time) || fxRateUSDTHB;

    // ── TO side: receiving an asset ─────────────────────────────────────────
    if (to_ticker && Number(to_amount) > 0) {
      applyReceive({
        pos:            getPos(to_ticker, to_asset_type, transaction_currency || 'USD'),
        ticker:         to_ticker,
        unitsReceived:  Number(to_amount),
        totalPaid:      Number(from_amount) || 0, // what was given up (value, not units)
        fees:           (fee_currency === to_ticker) ? Number(fees) : 0,
        txFxRate,
        transaction_currency,
      });
    }

    // ── FROM side: giving up an asset ───────────────────────────────────────
    if (from_ticker && Number(from_amount) > 0) {
      const fromPos = getPos(from_ticker, from_asset_type, transaction_currency || 'USD');

      if (isCashAsset(from_ticker)) {
        // Cash spent — subtract face value amount, avg_cost stays constant
        const cashFace     = cashAvgCost(from_ticker, txFxRate);
        const feeOnFromSide = (fee_currency === from_ticker) ? Number(fees) : 0;
        const totalDeducted = Number(from_amount) + feeOnFromSide;

        fromPos.quantity   -= totalDeducted;
        fromPos.avg_cost    = cashFace; // always reset to face value
        fromPos.cost_basis  = fromPos.quantity * fromPos.avg_cost;

      } else {
        // Non-cash given up (sell or swap out)
        // from_amount here = units of the asset given up
        const unitsSold      = Number(from_amount);
        const feeOnFromSide  = (fee_currency === from_ticker) ? Number(fees) : 0;
        const totalUnitsSold = unitsSold + feeOnFromSide;

        if (fromPos.quantity > 0) {
          // Realized P&L: (sale proceeds) - (cost of units sold)
          // sale proceeds = to_amount (cash received) in common currency
          const costOfUnitsSold = totalUnitsSold * fromPos.avg_cost;
          const saleProceeds    = Number(to_amount) || 0; // cash received
          fromPos.realized_pnl += (saleProceeds - costOfUnitsSold);

          // Reduce position
          fromPos.cost_basis -= costOfUnitsSold;
          fromPos.quantity   -= totalUnitsSold;

          // avg_cost does NOT change on sell (it represents original cost)
          // But guard against floating point dust
          if (fromPos.quantity <= 0.000000001) {
            fromPos.quantity   = 0;
            fromPos.cost_basis = 0;
            // avg_cost intentionally kept for reference until position truly resets
          }
        } else {
          // Position is already zero — this is a SHORT entry (handled separately)
          // For now: record as negative quantity (short exposure)
          fromPos.quantity  -= Number(from_amount);
          fromPos.cost_basis = fromPos.quantity * fromPos.avg_cost;
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // STEP 3 — Clean up dust positions (floating point near-zero)
  // ─────────────────────────────────────────────────────────────────────────
  for (const ticker of Object.keys(positions)) {
    const pos = positions[ticker];
    if (Math.abs(pos.quantity) < 0.000000001) {
      pos.quantity   = 0;
      pos.cost_basis = 0;
    }
    // cost_basis can never be negative for a long position
    // If it somehow is, clamp to 0 and log a warning
    if (pos.quantity >= 0 && pos.cost_basis < 0) {
      console.warn(
        `[positionCalculator] ⚠️ Negative cost_basis detected for ${ticker}: ${pos.cost_basis}. ` +
        `This indicates a data entry error (e.g. sold more than was bought). Clamping to 0.`
      );
      pos.cost_basis = 0;
      pos.avg_cost   = 0;
    }
  }

  return positions;
}


// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Apply a "receive" event to a position
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update a position when the user receives units of an asset.
 *
 * @param {Object} params
 * @param {Object} params.pos               The position object to mutate
 * @param {string} params.ticker            Asset ticker
 * @param {number} params.unitsReceived     How many units you got
 * @param {number} params.totalPaid         Total cash/value given up for this (0 for deposits)
 * @param {number} params.fees              Fees charged on this side
 * @param {number} params.txFxRate          USD/THB rate at tx time
 * @param {string} params.transaction_currency  'USD' or 'THB'
 */
function applyReceive({ pos, ticker, unitsReceived, totalPaid, fees, txFxRate, transaction_currency }) {
  if (isCashAsset(ticker)) {
    // ── Cash received (e.g. USD from selling a stock) ──────────────────────
    // avg_cost = face value always. Never use weighted average here.
    const faceValue   = cashAvgCost(ticker, txFxRate);
    pos.quantity     += unitsReceived;
    pos.avg_cost      = faceValue;
    pos.cost_basis    = pos.quantity * faceValue;

  } else {
    // ── Non-cash received (buying or swapping in) ──────────────────────────
    // Weighted average cost: new avg = (old cost basis + amount paid) / new qty
    //
    // "amount paid" = totalPaid (the cash or asset value given up) + fees on this side
    // This is exactly what you spent to acquire these units.
    const amountPaid   = totalPaid + fees;
    const newCostBasis = pos.cost_basis + amountPaid;
    const newQty       = pos.quantity   + unitsReceived;

    pos.quantity       = newQty;
    pos.cost_basis     = newCostBasis;
    pos.avg_cost       = newQty > 0 ? newCostBasis / newQty : 0;
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// ENRICHMENT: Combine positions with live prices
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Take calculated positions and attach live market prices + P&L.
 *
 * @param {Object} positions      Output of calculatePositions()
 * @param {Object} priceMap       { [ticker]: { price, currency } }
 * @param {number} fxRateUSDTHB  Current exchange rate
 * @param {string} displayCurrency  'USD' or 'THB'
 *
 * @returns {Array} Enriched position array, sorted by current value descending
 */
export function enrichPositions(positions, priceMap, fxRateUSDTHB = 35.0, displayCurrency = 'USD') {
  const result = [];

  for (const [ticker, pos] of Object.entries(positions)) {
    // Skip zero-quantity positions (closed out)
    if (pos.quantity === 0) continue;

    const priceData    = priceMap[ticker] || {};
    const rawPrice     = Number(priceData.price) || 0;
    const priceCur     = priceData.currency || 'USD'; // what currency Yahoo/CoinGecko returns

    // ── Convert everything to displayCurrency ──────────────────────────────

    // Current price in display currency
    let displayPrice = rawPrice;
    if (priceCur === 'USD' && displayCurrency === 'THB') displayPrice = rawPrice * fxRateUSDTHB;
    if (priceCur === 'THB' && displayCurrency === 'USD') displayPrice = rawPrice / fxRateUSDTHB;

    // Avg cost in display currency
    // pos.cost_currency is always 'USD' after calculation
    let displayAvgCost = pos.avg_cost;
    if (pos.cost_currency === 'USD' && displayCurrency === 'THB') displayAvgCost = pos.avg_cost * fxRateUSDTHB;
    if (pos.cost_currency === 'THB' && displayCurrency === 'USD') displayAvgCost = pos.avg_cost / fxRateUSDTHB;

    // ── P&L ───────────────────────────────────────────────────────────────
    const currentValue     = displayPrice * pos.quantity;
    const costBasisDisplay = displayAvgCost * pos.quantity;
    const unrealizedPnL    = currentValue - costBasisDisplay;
    const unrealizedPnLPct = costBasisDisplay > 0 ? (unrealizedPnL / costBasisDisplay) * 100 : 0;

    // Realized P&L also converted to display currency
    let realizedPnL = pos.realized_pnl;
    if (pos.cost_currency === 'USD' && displayCurrency === 'THB') realizedPnL = realizedPnL * fxRateUSDTHB;
    if (pos.cost_currency === 'THB' && displayCurrency === 'USD') realizedPnL = realizedPnL / fxRateUSDTHB;

    result.push({
      ticker,
      asset_type:        pos.asset_type,
      quantity:          pos.quantity,
      avg_cost:          displayAvgCost,
      cost_basis:        costBasisDisplay,
      current_price:     displayPrice,
      current_value:     currentValue,
      unrealized_pnl:    unrealizedPnL,
      unrealized_pnl_pct: Number(unrealizedPnLPct.toFixed(4)),
      realized_pnl:      realizedPnL,
      display_currency:  displayCurrency,
      price_updated_at:  priceData.updatedAt || null,
    });
  }

  // Sort: non-cash by value desc, cash positions at the bottom
  result.sort((a, b) => {
    const aIsCash = isCashAsset(a.ticker);
    const bIsCash = isCashAsset(b.ticker);
    if (aIsCash && !bIsCash) return 1;
    if (!aIsCash && bIsCash) return -1;
    return b.current_value - a.current_value;
  });

  return result;
}


// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute portfolio-level totals from enriched positions.
 *
 * @param {Array}  enrichedPositions  Output of enrichPositions()
 * @param {string} displayCurrency
 *
 * @returns {Object} Summary totals
 */
export function computePortfolioSummary(enrichedPositions, displayCurrency = 'USD') {
  let totalValue    = 0;
  let totalCost     = 0;
  let totalRealized = 0;

  for (const pos of enrichedPositions) {
    // Exclude cash from P&L totals (cash has no "gain/loss vs itself")
    if (isCashAsset(pos.ticker)) {
      totalValue += pos.current_value;
      // Don't count cash as "cost" — it's just liquidity
      continue;
    }
    totalValue    += pos.current_value;
    totalCost     += pos.cost_basis;
    totalRealized += pos.realized_pnl;
  }

  const unrealizedPnL    = totalValue - totalCost;
  const unrealizedPnLPct = totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : 0;

  return {
    total_value:           Number(totalValue.toFixed(2)),
    total_cost:            Number(totalCost.toFixed(2)),
    unrealized_pnl:        Number(unrealizedPnL.toFixed(2)),
    unrealized_pnl_pct:    Number(unrealizedPnLPct.toFixed(4)),
    realized_pnl:          Number(totalRealized.toFixed(2)),
    total_pnl:             Number((unrealizedPnL + totalRealized).toFixed(2)),
    display_currency:      displayCurrency,
  };
}


// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS (for testing / debugging)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanity-check a positions map. Returns a list of warnings.
 * Call this in development to catch data issues early.
 */
export function validatePositions(positions) {
  const warnings = [];
  for (const [ticker, pos] of Object.entries(positions)) {
    if (pos.quantity > 0 && pos.cost_basis < 0) {
      warnings.push(`${ticker}: positive quantity (${pos.quantity}) but negative cost_basis (${pos.cost_basis}). Likely sold more than bought.`);
    }
    if (pos.avg_cost < 0) {
      warnings.push(`${ticker}: negative avg_cost (${pos.avg_cost}). Data integrity error.`);
    }
    if (isCashAsset(ticker) && Math.abs(pos.avg_cost - 1.0) > 0.001 && !isTHBCash(ticker)) {
      warnings.push(`${ticker}: cash asset has avg_cost ${pos.avg_cost} (expected 1.0). May indicate wrong calculation path.`);
    }
    if (pos.quantity < -0.001) {
      warnings.push(`${ticker}: negative quantity (${pos.quantity}). Could be a SHORT position or a data entry error.`);
    }
  }
  return warnings;
}
