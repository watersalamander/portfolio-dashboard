/**
 * portfolioRoute.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Replace the existing GET /api/portfolio handler in server.js with this.
 * Also adds:
 *   POST /api/initial-positions   — save onboarding data
 *   GET  /api/initial-positions   — fetch for editing
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * HOW TO INTEGRATE:
 *   1. Copy positionCalculator.js to src/services/positionCalculator.js
 *   2. Copy this file to src/routes/portfolioRoute.js
 *   3. In server.js add:
 *        import portfolioRouter from './routes/portfolioRoute.js';
 *        app.use('/api', portfolioRouter);
 *   4. Remove the old GET /api/portfolio handler from server.js
 */

import express from 'express';
import { createClient } from '@supabase/supabase-js';
import {
  calculatePositions,
  enrichPositions,
  computePortfolioSummary,
  validatePositions,
} from '../services/positionCalculator.js';

const router = express.Router();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

async function getUserId(req) {
  // Get user email from query parameter
  const userEmail = req.query.user_email || req.body.user_email;
  console.log('[getUserId] Looking for user:', userEmail);
  
  // Try Authorization header (this is the important part!)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    console.log('[getUserId] Found Bearer token - creating authenticated client');
    const token = authHeader.replace('Bearer ', '');
    
    try {
      // Create a NEW Supabase client using the user's token
      const authenticatedSupabase = createClient(
        process.env.SUPABASE_URL,
        process.env.SUPABASE_ANON_KEY,
        {
          global: {
            headers: {
              Authorization: `Bearer ${token}`
            }
          }
        }
      );
      
      // Verify the token and get the user
      const { data: { user }, error: authError } = await authenticatedSupabase.auth.getUser();
      
      if (authError) {
        console.error('[getUserId] Token validation failed:', authError);
        return null;
      }
      
      if (!user) {
        console.error('[getUserId] No user from token');
        return null;
      }
      
      console.log('[getUserId] ✅ Token validated for user:', user.email);
      
      // Now query profiles using the authenticated client
      const { data: profile, error } = await authenticatedSupabase
        .from('profiles')
        .select('id, email, display_currency, onboarding_completed')
        .eq('id', user.id)
        .maybeSingle();
      
      if (error) {
        console.error('[getUserId] Error fetching profile:', error);
        return null;
      }
      
      if (profile) {
        console.log(`[getUserId] ✅ Found profile: ${profile.email}`);
        return profile;
      } else {
        console.warn(`[getUserId] ❌ No profile found for user id: ${user.id}`);
        return null;
      }
      
    } catch (e) {
      console.error('[getUserId] Unexpected error:', e);
      return null;
    }
  }

  // Fallback: try email lookup (less secure, but works for dev)
  if (userEmail) {
    console.log('[getUserId] No token - falling back to email lookup (insecure!)');
    const { data: profile, error } = await supabase
      .from('profiles')
      .select('id, email, display_currency, onboarding_completed')
      .eq('email', userEmail)
      .maybeSingle();
    
    if (error) {
      console.error('[getUserId] Email lookup error:', error);
      return null;
    }
    
    if (profile) {
      console.log(`[getUserId] ⚠️ Found user via email (bypassed RLS): ${profile.email}`);
      return profile;
    }
  }

  console.warn('[getUserId] ❌ Could not identify user');
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: fetch live USD/THB exchange rate
// ─────────────────────────────────────────────────────────────────────────────
async function fetchFxRate() {
  try {
    // Yahoo Finance: THBUSD=X gives THB per USD — we want USD per THB (inverse)
    const resp = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/THB=X?interval=1d&range=1d'
    );
    const json = await resp.json();
    const rate = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    // THB=X returns how many THB per 1 USD (e.g. 35.2)
    if (rate && rate > 0) return Number(rate);
  } catch (e) {
    console.warn('[portfolioRoute] FX rate fetch failed, using fallback:', e.message);
  }
  return 35.0; // fallback
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: build price map from asset_metadata table
// { [ticker]: { price, currency, updatedAt } }
// ─────────────────────────────────────────────────────────────────────────────
async function getPriceMap(tickers) {
  if (!tickers.length) return {};

  const { data, error } = await supabase
    .from('asset_metadata')
    .select('ticker, current_price, price_currency, last_price_update')
    .in('ticker', tickers);

  if (error) {
    console.error('[portfolioRoute] Price map fetch error:', error);
    return {};
  }

  const map = {};
  for (const row of data || []) {
    map[row.ticker] = {
      price:     Number(row.current_price) || 0,
      currency:  row.price_currency || 'USD',
      updatedAt: row.last_price_update,
    };
  }
  return map;
}


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/portfolio
// ─────────────────────────────────────────────────────────────────────────────
router.get('/portfolio', async (req, res) => {
  try {
    const profile = await getUserId(req);
    if (!profile) {
      return res.status(404).json({ error: 'No user found' });
    }

    const { id: userId, display_currency: displayCurrency = 'USD', onboarding_completed } = profile;

    // If onboarding not done, tell the frontend to redirect
    if (!onboarding_completed) {
      return res.json({ onboarding_required: true });
    }

    // ── 1. Fetch initial positions ─────────────────────────────────────────
    const { data: initialPositions, error: ipError } = await supabase
      .from('initial_positions')
      .select('*')
      .eq('user_id', userId);

    if (ipError) throw ipError;

    // ── 2. Fetch all transactions (chronological) ──────────────────────────
    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: true });

    if (txError) throw txError;

    // ── 3. Get exchange rate ───────────────────────────────────────────────
    const fxRate = await fetchFxRate();

    // ── 4. Calculate positions ─────────────────────────────────────────────
    const positions = calculatePositions(
      initialPositions || [],
      transactions     || [],
      fxRate
    );

    // ── 5. Dev: log any warnings ───────────────────────────────────────────
    if (process.env.NODE_ENV !== 'production') {
      const warnings = validatePositions(positions);
      if (warnings.length) {
        console.warn('[positionCalculator] Warnings:', warnings);
      }
    }

    // ── 6. Fetch prices for all tickers we have positions in ───────────────
    const tickers  = Object.keys(positions);
    const priceMap = await getPriceMap(tickers);

    // ── 7. Enrich positions with market data ───────────────────────────────
    const enriched = enrichPositions(positions, priceMap, fxRate, displayCurrency);

    // ── 8. Portfolio-level summary ─────────────────────────────────────────
    const summary = computePortfolioSummary(enriched, displayCurrency);

    res.json({
      positions:    enriched,
      summary,
      exchange_rate: fxRate,
      display_currency: displayCurrency,
      last_updated: new Date().toISOString(),
    });

  } catch (err) {
    console.error('[portfolioRoute] GET /portfolio error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// GET /api/initial-positions
// Returns the user's initial positions (for editing on the onboarding page)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/initial-positions', async (req, res) => {
  try {
    const profile = await getUserId(req);
    if (!profile) return res.status(404).json({ error: 'No user found' });

    const { data, error } = await supabase
      .from('initial_positions')
      .select('*')
      .eq('user_id', profile.id)
      .order('created_at', { ascending: true });

    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error('[portfolioRoute] GET /initial-positions error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/initial-positions
// Save (upsert) the user's initial holdings during onboarding.
// Body: { positions: [{ ticker, asset_name, asset_type, quantity, avg_cost, cost_currency }] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/initial-positions', async (req, res) => {
  try {
    const profile = await getUserId(req);
    if (!profile) return res.status(404).json({ error: 'No user found' });

    const { positions: incoming } = req.body;

    if (!Array.isArray(incoming) || incoming.length === 0) {
      return res.status(400).json({ error: 'positions array is required' });
    }

    // Validate each row
    const rows = [];
    for (const pos of incoming) {
      const ticker       = (pos.ticker || '').toUpperCase().trim();
      const quantity     = Number(pos.quantity);
      const avg_cost     = Number(pos.avg_cost) || 0;
      const cost_currency = pos.cost_currency === 'THB' ? 'THB' : 'USD';

      if (!ticker)           return res.status(400).json({ error: `Missing ticker in row: ${JSON.stringify(pos)}` });
      if (isNaN(quantity) || quantity < 0) return res.status(400).json({ error: `Invalid quantity for ${ticker}` });
      if (avg_cost < 0)      return res.status(400).json({ error: `Negative avg_cost for ${ticker}` });

      rows.push({
        user_id:       profile.id,
        ticker,
        asset_name:    pos.asset_name || ticker,
        asset_type:    pos.asset_type || 'other',
        quantity,
        avg_cost,
        cost_currency,
        notes:         pos.notes || null,
      });
    }

    // Upsert (insert or update if ticker already exists for this user)
    const { data, error } = await supabase
      .from('initial_positions')
      .upsert(rows, { onConflict: 'user_id,ticker' })
      .select();

    if (error) throw error;

    // Mark onboarding as complete
    await supabase
      .from('profiles')
      .update({ onboarding_completed: true })
      .eq('id', profile.id);

    res.json({ success: true, saved: data.length });
  } catch (err) {
    console.error('[portfolioRoute] POST /initial-positions error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/initial-positions/:ticker
// Remove a single initial position (user correcting a mistake during onboarding)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/initial-positions/:ticker', async (req, res) => {
  try {
    const profile = await getUserId(req);
    if (!profile) return res.status(404).json({ error: 'No user found' });

    const ticker = req.params.ticker.toUpperCase();

    const { error } = await supabase
      .from('initial_positions')
      .delete()
      .eq('user_id', profile.id)
      .eq('ticker', ticker);

    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    console.error('[portfolioRoute] DELETE /initial-positions error:', err);
    res.status(500).json({ error: err.message });
  }
});


// ─────────────────────────────────────────────────────────────────────────────
// POST /api/transactions  (updated version — replaces existing handler)
// Accepts the new double-entry format with transaction_currency
// ─────────────────────────────────────────────────────────────────────────────
router.post('/transactions', async (req, res) => {
  try {
    const profile = await getUserId(req);
    if (!profile) return res.status(404).json({ error: 'No user found' });

    const {
      transaction_type,   // 'buy', 'sell', 'swap', 'transfer_in', 'transfer_out'
      to_ticker,
      to_amount,
      to_asset_type,
      from_ticker,        // null for deposits/transfer_in
      from_amount,        // null for deposits/transfer_in
      from_asset_type,
      transaction_currency, // 'USD' or 'THB'
      price_per_unit,     // used to derive from_amount if not explicitly set
      fees,
      fee_currency,
      notes,
      platform,
      transaction_date,
    } = req.body;

    // ── Derive from_amount from price_per_unit if not provided ────────────
    // This is what the "Total Spent" field in the form produces.
    // from_amount = total cash spent = to_amount × price_per_unit
    let resolvedFromAmount = from_amount;
    if (!resolvedFromAmount && price_per_unit && to_amount) {
      resolvedFromAmount = Number(to_amount) * Number(price_per_unit);
    }

    // ── Determine from_ticker for buy/sell if not provided ────────────────
    // For a "Buy" transaction in the CoinGecko-style form:
    //   the user picks currency (USD/THB/USDT) which becomes from_ticker
    let resolvedFromTicker     = from_ticker;
    let resolvedFromAssetType  = from_asset_type;

    if (transaction_type === 'buy' && !resolvedFromTicker && transaction_currency) {
      resolvedFromTicker    = transaction_currency; // 'USD' or 'THB'
      resolvedFromAssetType = 'cash';
    }
    if (transaction_type === 'sell' && !resolvedFromTicker) {
      resolvedFromTicker    = to_ticker;    // what you're selling
      resolvedFromAssetType = to_asset_type;
    }

    // ── Fetch fx rate at tx time ───────────────────────────────────────────
    const fxRate = await fetchFxRate(); // In production: use the tx date for historical rate

    const row = {
      user_id:              profile.id,
      transaction_type:     transaction_type || 'trade',
      transaction_date:     transaction_date || new Date().toISOString(),
      transaction_currency: transaction_currency || 'USD',
      fx_rate_at_time:      fxRate,

      to_ticker:            to_ticker?.toUpperCase(),
      to_amount:            Number(to_amount),
      to_asset_type:        to_asset_type || 'other',

      from_ticker:          resolvedFromTicker?.toUpperCase() || null,
      from_amount:          resolvedFromAmount ? Number(resolvedFromAmount) : null,
      from_asset_type:      resolvedFromAssetType || null,

      fees:                 Number(fees) || 0,
      fee_currency:         fee_currency || transaction_currency || 'USD',
      notes:                notes || null,
      platform:             platform || null,
    };

    const { data, error } = await supabase
      .from('transactions')
      .insert(row)
      .select();

    if (error) throw error;

    res.json({ success: true, transaction: data[0] });
  } catch (err) {
    console.error('[portfolioRoute] POST /transactions error:', err);
    res.status(500).json({ error: err.message });
  }
});


export default router;
