/**
 * positionCalculator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Mirrors MVP1 (Google Sheets) logic exactly, adapted for Supabase multi-user:
 *
 *  STEP 1 — Load Initial Positions (opening balances entered during onboarding)
 *            These are snapshots: quantity + avg_cost per asset.
 *            Negative quantity = SHORT position (set during onboarding).
 *
 *  STEP 2 — Apply Transactions in chronological order (double-entry ledger).
 *            Every trade is FROM one asset TO another:
 *              • BUY  : from=USD/THB  → to=asset
 *              • SELL : from=asset    → to=USD/THB
 *              • SWAP : from=assetA   → to=assetB
 *              • DEPOSIT   : from=null → to=asset   (transfer in)
 *              • WITHDRAWAL: from=asset → to=null   (transfer out)
 *
 *  SHORT positions are tracked as negative quantity, matching MVP1's shortQty.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS & GUARDS
// ─────────────────────────────────────────────────────────────────────────────

const DUST = 1e-9;  // floating-point dust threshold

/**
 * Returns true if ticker represents a cash / stablecoin position.
 * Convention: 'CASH-USD', 'CASH-THB', 'USD', 'THB', 'USDT', 'USDC', 'BUSD'
 */
export function isCashAsset(ticker) {
  if (!ticker) return false;
  const t = ticker.toUpperCase();
  return (
    t.startsWith('CASH-') ||
    t === 'USD' ||
    t === 'THB' ||
    t === 'USDT' ||
    t === 'USDC' ||
    t === 'BUSD' ||
    t === 'DAI'  ||
    t === 'TUSD'
  );
}

/** Returns true if the ticker is THB-denominated cash */
export function isTHBCash(ticker) {
  if (!ticker) return false;
  const t = ticker.toUpperCase();
  return t === 'THB' || t === 'CASH-THB';
}

/**
 * Face value of 1 unit of a cash asset in USD.
 * USD cash = 1.00, THB cash = 1/fxRate (e.g. 1 THB = 1/35 USD).
 */
function cashFaceValueUSD(ticker, fxRateUSDTHB) {
  if (isTHBCash(ticker)) return 1 / (fxRateUSDTHB || 35);
  return 1.0; // USD stablecoins
}

// ─────────────────────────────────────────────────────────────────────────────
// POSITION SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

function createPosition(ticker, assetType, costCurrency) {
  return {
    ticker,
    asset_type:    assetType || 'other',
    quantity:      0,     // negative = short
    avg_cost:      0,     // avg cost per unit in cost_currency (USD or THB)
    cost_basis:    0,     // quantity × avg_cost  (always positive for longs)
    cost_currency: costCurrency || 'USD',
    realized_pnl:  0,     // accumulated realized P&L (same currency as cost_currency)
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate current positions from initial holdings + transaction history.
 *
 * Mirrors MVP1 logic:
 *   1. Seed positions from initial_positions table (same as Initial_Positions sheet)
 *   2. Apply transactions (same as Transactions sheet double-entry logic)
 *
 * @param {Array}  initialPositions  Rows from initial_positions table
 * @param {Array}  transactions      Rows from transactions table (any order; sorted internally)
 * @param {number} fxRateUSDTHB      Current USD→THB rate (used for cash face value)
 * @returns {Object}  Map: ticker → position object
 */
export function calculatePositions(initialPositions = [], transactions = [], fxRateUSDTHB = 35.0) {
  const positions = {};

  // ── Helper: get or create a position slot ──────────────────────────────
  function getPos(ticker, assetType, costCurrency) {
    if (!ticker) return null;
    const key = ticker.toUpperCase();
    if (!positions[key]) {
      positions[key] = createPosition(key, assetType, costCurrency || 'USD');
    }
    // Upgrade asset_type if we get a more specific value later
    const pos = positions[key];
    if (assetType && assetType !== 'other' && pos.asset_type === 'other') {
      pos.asset_type = assetType;
    }
    return pos;
  }

  // ───────────────────────────────────────────────────────────────────────
  // STEP 1 — Seed from initial positions (MVP1: Initial_Positions sheet)
  // ───────────────────────────────────────────────────────────────────────
  for (const init of initialPositions) {
    if (!init.ticker) continue;

    const ticker   = init.ticker.toUpperCase();
    const qty      = Number(init.quantity)  || 0;
    const avgCost  = Number(init.avg_cost)  || 0;
    const cur      = init.cost_currency === 'THB' ? 'THB' : 'USD';

    const pos = getPos(ticker, init.asset_type, cur);

    if (isCashAsset(ticker)) {
      // Cash: face value is always 1 unit = 1 USD (or 1/fxRate for THB).
      // We never trust user-stated avg_cost for cash — it's just 1:1.
      const faceUSD    = cashFaceValueUSD(ticker, fxRateUSDTHB);
      pos.quantity     = qty;          // can be negative (overdraft edge case)
      pos.avg_cost     = faceUSD;
      pos.cost_basis   = qty * faceUSD;
      pos.cost_currency = 'USD';       // always store cash cost in USD
    } else {
      // Non-cash: accept the user's stated avg_cost as the opening cost basis.
      // Negative qty = SHORT position (user entered it in onboarding as negative).
      pos.quantity     = qty;
      pos.avg_cost     = avgCost;
      pos.cost_basis   = Math.abs(qty) * avgCost; // cost_basis always positive
      pos.cost_currency = cur;
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  // STEP 2 — Apply transactions in chronological order
  //           (MVP1: Transactions sheet double-entry logic)
  // ───────────────────────────────────────────────────────────────────────
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.transaction_date) - new Date(b.transaction_date)
  );

  for (const tx of sorted) {
    const {
      from_ticker,
      from_amount,      // BUY: cash spent;  SELL/SWAP: units of asset given up
      from_asset_type,
      to_ticker,
      to_amount,        // units received (BUY: asset qty;  SELL: cash received)
      to_asset_type,
      fees              = 0,
      fee_currency,
      transaction_currency = 'USD',   // 'USD' or 'THB' — the denomination
      fx_rate_at_time,                // USD/THB at tx time (optional)
    } = tx;

    const txFxRate = Number(fx_rate_at_time) > 0 ? Number(fx_rate_at_time) : fxRateUSDTHB;

    // ── TO side: receiving an asset ──────────────────────────────────────
    if (to_ticker && Number(to_amount) > 0) {
      const toPos = getPos(to_ticker, to_asset_type, transaction_currency);
      const unitsIn = Number(to_amount);
      const feesToSide = (fee_currency === to_ticker) ? Math.abs(Number(fees)) : 0;

      if (isCashAsset(to_ticker)) {
        // Receiving cash: just add units at face value
        const face      = cashFaceValueUSD(to_ticker, txFxRate);
        toPos.quantity += unitsIn;
        toPos.avg_cost  = face;
        toPos.cost_basis = Math.abs(toPos.quantity) * face;
        toPos.cost_currency = 'USD';

      } else if (toPos.quantity < 0) {
        // ── SHORT COVER: buying back a short position ────────────────────
        // MVP1 COVER logic: reduce shortQty, calculate realized P&L
        const unitsCovered = Math.min(unitsIn, Math.abs(toPos.quantity));
        // from_amount = cash paid to cover
        const cashPaid     = Number(from_amount) || 0;
        const pricePerUnit = unitsCovered > 0 ? cashPaid / unitsCovered : 0;
        // Short P&L: made money when cover price < avg_cost (original short entry)
        const shortRealized = (toPos.avg_cost - pricePerUnit) * unitsCovered;
        toPos.realized_pnl += shortRealized;
        toPos.quantity     += unitsCovered;  // moves toward 0 (less negative)
        toPos.cost_basis    = Math.abs(toPos.quantity) * toPos.avg_cost;

      } else {
        // ── LONG BUY: weighted-average cost basis ───────────────────────
        // MVP1 BUY logic: longCost += totalCost, longQty += qty, avg recalculated
        const cashPaid    = Number(from_amount) || 0; // total amount paid (USD or THB)
        const effectiveFees = feesToSide;             // fees charged on the TO side
        const totalCostIn = cashPaid + effectiveFees;

        toPos.quantity   += unitsIn;
        toPos.cost_basis += totalCostIn;
        toPos.avg_cost    = toPos.quantity > 0 ? toPos.cost_basis / toPos.quantity : 0;
        // Keep cost_currency consistent with how the trade was denominated
        toPos.cost_currency = transaction_currency || toPos.cost_currency;
      }
    }

    // ── FROM side: giving up an asset ────────────────────────────────────
    if (from_ticker && Number(from_amount) > 0) {
      const fromPos = getPos(from_ticker, from_asset_type, transaction_currency);
      const feesFromSide = (fee_currency === from_ticker) ? Math.abs(Number(fees)) : 0;

      if (isCashAsset(from_ticker)) {
        // Cash spent: deduct face value amount
        // from_amount = total cash dollars/baht spent (already the full amount)
        const totalDeducted = Number(from_amount) + feesFromSide;
        const face          = cashFaceValueUSD(from_ticker, txFxRate);
        fromPos.quantity   -= totalDeducted;
        fromPos.avg_cost    = face;
        fromPos.cost_basis  = Math.abs(fromPos.quantity) * face;
        fromPos.cost_currency = 'USD';

      } else if (fromPos.quantity > 0) {
        // ── LONG SELL: MVP1 SELL logic ───────────────────────────────────
        // reduce longQty, calculate realized P&L, reduce longCost proportionally
        const unitsSold       = Number(from_amount);             // units of asset sold
        const totalUnitsSold  = unitsSold + feesFromSide;        // include any fee in-kind
        const safeQty         = Math.max(fromPos.quantity, 0.000000001);
        const avgCostPerUnit  = fromPos.cost_basis / safeQty;

        // Realized P&L = proceeds - cost of units sold
        // Proceeds = cash received (to_amount, in transaction_currency)
        const proceeds     = Number(to_amount) || 0;
        const costOfSold   = totalUnitsSold * avgCostPerUnit;
        fromPos.realized_pnl += (proceeds - costOfSold);

        fromPos.cost_basis -= costOfSold;
        fromPos.quantity   -= totalUnitsSold;

        // Clean up floating-point dust
        if (fromPos.quantity < DUST) { fromPos.quantity = 0; fromPos.cost_basis = 0; }
        // avg_cost intentionally preserved (useful for reference even at 0 qty)

      } else {
        // ── SHORT SELL / SHORT ENTRY ─────────────────────────────────────
        // Opening or adding to a short position
        // from_amount = units shorted, from_ticker = asset being shorted
        const unitsShorted = Number(from_amount);
        const proceeds     = Number(to_amount) || 0; // cash received from short sale
        const pricePerUnit = unitsShorted > 0 ? proceeds / unitsShorted : 0;

        // weighted-average the short avg_cost (analogous to MVP1 shortCost/shortQty)
        const prevShortQty  = Math.abs(fromPos.quantity);
        const prevShortCost = fromPos.cost_basis;
        const newShortQty   = prevShortQty + unitsShorted;
        fromPos.quantity   -= unitsShorted;  // goes more negative
        fromPos.cost_basis  = prevShortCost + (unitsShorted * pricePerUnit);
        fromPos.avg_cost    = newShortQty > 0 ? fromPos.cost_basis / newShortQty : pricePerUnit;
      }
    }
  }

  // ── STEP 3: Clean up dust and guard against bad states ─────────────────
  for (const ticker of Object.keys(positions)) {
    const pos = positions[ticker];

    // Float dust → zero
    if (Math.abs(pos.quantity) < DUST) {
      pos.quantity   = 0;
      pos.cost_basis = 0;
    }

    // cost_basis must never be negative for a long
    if (pos.quantity >= 0 && pos.cost_basis < 0) {
      console.warn(`[positionCalculator] ⚠️ Negative cost_basis for ${ticker} (${pos.cost_basis}). Clamping to 0.`);
      pos.cost_basis = 0;
      pos.avg_cost   = 0;
    }

    // Recalculate avg_cost from cost_basis to keep them consistent
    if (pos.quantity !== 0 && pos.cost_basis >= 0) {
      pos.avg_cost = pos.cost_basis / Math.abs(pos.quantity);
    }
  }

  return positions;
}

// ─────────────────────────────────────────────────────────────────────────────
// ENRICHMENT: Attach live prices + convert to display currency
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} positions      Output of calculatePositions()
 * @param {Object} priceMap       { [ticker]: { price, currency, updatedAt } }
 * @param {number} fxRateUSDTHB
 * @param {string} displayCurrency  'USD' or 'THB'
 * @returns {Array} Enriched sorted array
 */
export function enrichPositions(positions, priceMap, fxRateUSDTHB = 35.0, displayCurrency = 'USD') {
  const result = [];

  for (const [ticker, pos] of Object.entries(positions)) {
    if (pos.quantity === 0) continue; // skip closed positions

    const priceData  = priceMap[ticker] || {};
    const rawPrice   = Number(priceData.price)    || 0;
    const priceCur   = priceData.currency || 'USD';

    // Convert price to displayCurrency
    let displayPrice = rawPrice;
    if (priceCur === 'USD' && displayCurrency === 'THB') displayPrice = rawPrice * fxRateUSDTHB;
    if (priceCur === 'THB' && displayCurrency === 'USD') displayPrice = rawPrice / fxRateUSDTHB;

    // Convert avg_cost to displayCurrency
    let displayAvgCost = pos.avg_cost;
    if (pos.cost_currency === 'USD' && displayCurrency === 'THB') displayAvgCost = pos.avg_cost * fxRateUSDTHB;
    if (pos.cost_currency === 'THB' && displayCurrency === 'USD') displayAvgCost = pos.avg_cost / fxRateUSDTHB;

    const absQty       = Math.abs(pos.quantity);
    const isShort      = pos.quantity < 0;
    const currentValue = displayPrice * absQty;
    const costDisplay  = displayAvgCost * absQty;

    // P&L direction flips for shorts (profit when price falls)
    let unrealizedPnL;
    if (isShort) {
      unrealizedPnL = costDisplay - currentValue; // short P&L
    } else {
      unrealizedPnL = currentValue - costDisplay;
    }
    const unrealizedPct = costDisplay > 0 ? (unrealizedPnL / costDisplay) * 100 : 0;

    // Realized P&L currency conversion
    let realizedPnL = pos.realized_pnl;
    if (pos.cost_currency === 'USD' && displayCurrency === 'THB') realizedPnL *= fxRateUSDTHB;
    if (pos.cost_currency === 'THB' && displayCurrency === 'USD') realizedPnL /= fxRateUSDTHB;

    result.push({
      ticker,
      asset_type:          pos.asset_type,
      quantity:            pos.quantity,         // negative for shorts
      is_short:            isShort,
      avg_cost:            displayAvgCost,
      cost_basis:          costDisplay,
      current_price:       displayPrice,
      current_value:       isShort ? costDisplay - unrealizedPnL : currentValue,
      unrealized_pnl:      unrealizedPnL,
      unrealized_pnl_pct:  Number(unrealizedPct.toFixed(4)),
      realized_pnl:        realizedPnL,
      display_currency:    displayCurrency,
      price_updated_at:    priceData.updatedAt || null,
    });
  }

  // Sort: investments by value desc, cash at bottom
  result.sort((a, b) => {
    const aC = isCashAsset(a.ticker);
    const bC = isCashAsset(b.ticker);
    if (aC && !bC) return 1;
    if (!aC && bC) return -1;
    return Math.abs(b.current_value) - Math.abs(a.current_value);
  });

  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// PORTFOLIO SUMMARY
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Array}  enrichedPositions  Output of enrichPositions()
 * @param {string} displayCurrency
 * @returns {Object}
 */
export function computePortfolioSummary(enrichedPositions, displayCurrency = 'USD') {
  let totalValue    = 0;
  let totalCost     = 0;
  let totalRealized = 0;

  for (const pos of enrichedPositions) {
    if (isCashAsset(pos.ticker)) {
      totalValue += pos.current_value; // cash contributes to value but not cost/P&L
      continue;
    }
    totalValue    += pos.current_value;
    totalCost     += pos.cost_basis;
    totalRealized += pos.realized_pnl;
  }

  const unrealizedPnL = totalValue - totalCost;
  const unrealizedPct = totalCost > 0 ? (unrealizedPnL / totalCost) * 100 : 0;

  return {
    total_value:        Number(totalValue.toFixed(2)),
    total_cost:         Number(totalCost.toFixed(2)),
    unrealized_pnl:     Number(unrealizedPnL.toFixed(2)),
    unrealized_pnl_pct: Number(unrealizedPct.toFixed(4)),
    realized_pnl:       Number(totalRealized.toFixed(2)),
    total_pnl:          Number((unrealizedPnL + totalRealized).toFixed(2)),
    display_currency:   displayCurrency,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanity-check a positions map. Returns array of human-readable warning strings.
 * Call in development to catch data integrity issues early.
 */
export function validatePositions(positions) {
  const warnings = [];
  for (const [ticker, pos] of Object.entries(positions)) {
    if (pos.quantity > 0 && pos.cost_basis < 0) {
      warnings.push(`${ticker}: positive quantity (${pos.quantity}) but negative cost_basis (${pos.cost_basis}). Sold more than bought?`);
    }
    if (pos.avg_cost < 0) {
      warnings.push(`${ticker}: negative avg_cost (${pos.avg_cost}). Data integrity error.`);
    }
    if (isCashAsset(ticker) && pos.quantity !== 0 && Math.abs(pos.avg_cost - 1.0) > 0.01 && !isTHBCash(ticker)) {
      warnings.push(`${ticker}: USD cash avg_cost is ${pos.avg_cost} (expected ~1.0).`);
    }
  }
  return warnings;
}