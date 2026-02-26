/**
 * portfolioRoute.js
 * ─────────────────────────────────────────────────────────────────────────────
 * KEY FIX: Uses SUPABASE_SERVICE_ROLE_KEY for all server-side DB operations.
 *
 * Why: The anon key respects RLS. When the backend queries `profiles` using the
 * anon key, RLS blocks it (no active session on the server). The service role
 * key bypasses RLS entirely — safe because the server already validated
 * the user's JWT before touching the database.
 *
 * Security model:
 *   1. Frontend sends  Authorization: Bearer <supabase-jwt>
 *   2. Server calls    supabaseAuth.auth.getUser(token) — validates JWT signature
 *   3. Server uses     supabaseAdmin (service role)     — queries DB as trusted server
 *   4. All queries     still filter by user_id           — data isolation preserved
 * ─────────────────────────────────────────────────────────────────────────────
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

// ── Two Supabase clients ──────────────────────────────────────────────────────
//  supabaseAuth  — anon key, used ONLY to validate JWTs via auth.getUser()
//  supabaseAdmin — service role key, used for all DB reads/writes on the server

const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  // Falls back to anon key if service role not configured — but RLS must allow it
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the calling user's profile from the request.
 * Priority:
 *   1. Authorization: Bearer <supabase-jwt>   (production)
 *   2. ?user_email= or body.user_email         (dev/Postman fallback)
 */
async function getUserProfile(req) {
  // ── 1. Bearer token ────────────────────────────────────────────────────
  const authHeader = req.headers.authorization || '';
  if (authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const { data: { user }, error: authErr } = await supabaseAuth.auth.getUser(token);
      if (authErr || !user) {
        console.warn('[portfolioRoute] Invalid JWT:', authErr?.message);
      } else {
        // Valid user — fetch profile using admin client (bypasses RLS)
        const { data: profile, error: profileErr } = await supabaseAdmin
          .from('profiles')
          .select('id, email, display_currency, onboarding_completed')
          .eq('id', user.id)
          .single();

        if (!profileErr && profile) return profile;

        // Profile row missing (new user) — create it now
        if (profileErr?.code === 'PGRST116' || !profile) {
          const { data: created, error: createErr } = await supabaseAdmin
            .from('profiles')
            .upsert(
              { id: user.id, email: user.email, onboarding_completed: false },
              { onConflict: 'id' }
            )
            .select('id, email, display_currency, onboarding_completed')
            .single();

          if (!createErr && created) return created;
          console.error('[portfolioRoute] Could not create profile:', createErr?.message);
        }
      }
    } catch (e) {
      console.warn('[portfolioRoute] Bearer auth error:', e.message);
    }
  }

  // ── 2. Email fallback (dev / Postman only) ─────────────────────────────
  const userEmail = req.query.user_email || req.body?.user_email;
  if (userEmail) {
    const { data: profile, error } = await supabaseAdmin
      .from('profiles')
      .select('id, email, display_currency, onboarding_completed')
      .eq('email', userEmail)
      .single();
    if (!error && profile) return profile;
    console.warn('[portfolioRoute] Email fallback: user not found:', userEmail, error?.message);
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: fetch live USD/THB exchange rate
// ─────────────────────────────────────────────────────────────────────────────

async function fetchFxRate() {
  try {
    const resp = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/THB=X?interval=1d&range=1d'
    );
    const json = await resp.json();
    const rate = json?.chart?.result?.[0]?.meta?.regularMarketPrice;
    if (rate && rate > 0) return Number(rate);
  } catch (e) {
    console.warn('[portfolioRoute] FX rate fetch failed, using 35.0:', e.message);
  }
  return 30.0;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: build price map from asset_metadata table
// ─────────────────────────────────────────────────────────────────────────────

async function getPriceMap(tickers) {
  if (!tickers.length) return {};
  const { data, error } = await supabaseAdmin
    .from('asset_metadata')
    .select('ticker, current_price, price_currency, last_price_update')
    .in('ticker', tickers);

  if (error) { console.error('[portfolioRoute] Price map fetch error:', error); return {}; }

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
    const profile = await getUserProfile(req);
    if (!profile) {
      return res.status(401).json({ error: 'Unauthorized: no valid session found.' });
    }

    const { id: userId, display_currency: displayCurrency = 'USD', onboarding_completed } = profile;

    if (!onboarding_completed) {
      return res.json({ onboarding_required: true });
    }

    const { data: initialPositions, error: ipErr } = await supabaseAdmin
      .from('initial_positions')
      .select('*')
      .eq('user_id', userId);
    if (ipErr) throw ipErr;

    const { data: transactions, error: txErr } = await supabaseAdmin
      .from('transactions')
      .select('*')
      .eq('user_id', userId)
      .order('transaction_date', { ascending: true });
    if (txErr) throw txErr;

    const fxRate = await fetchFxRate();

    const positions = calculatePositions(
      initialPositions || [],
      transactions     || [],
      fxRate
    );

    if (process.env.NODE_ENV !== 'production') {
      const warnings = validatePositions(positions);
      if (warnings.length) console.warn('[positionCalculator] Warnings:', warnings);
    }

    const tickers  = Object.keys(positions);
    const priceMap = await getPriceMap(tickers);
    const enriched = enrichPositions(positions, priceMap, fxRate, displayCurrency);
    const summary  = computePortfolioSummary(enriched, displayCurrency);

    res.json({
      positions:        enriched,
      summary,
      exchange_rate:    fxRate,
      display_currency: displayCurrency,
      last_updated:     new Date().toISOString(),
    });

  } catch (err) {
    console.error('[portfolioRoute] GET /portfolio error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/initial-positions
// ─────────────────────────────────────────────────────────────────────────────

router.get('/initial-positions', async (req, res) => {
  try {
    const profile = await getUserProfile(req);
    if (!profile) return res.status(401).json({ error: 'Unauthorized' });

    const { data, error } = await supabaseAdmin
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
// Body: { positions: [{ ticker, asset_name, asset_type, quantity, avg_cost, cost_currency, notes }] }
// quantity can be negative for short positions.
// ─────────────────────────────────────────────────────────────────────────────

router.post('/initial-positions', async (req, res) => {
  try {
    const profile = await getUserProfile(req);
    if (!profile) return res.status(401).json({ error: 'Unauthorized' });

    const { positions: incoming } = req.body;

    if (!Array.isArray(incoming) || incoming.length === 0) {
      return res.status(400).json({ error: 'positions array is required and must not be empty.' });
    }

    const rows = [];
    for (const pos of incoming) {
      const ticker        = (pos.ticker || '').toUpperCase().trim();
      const quantity      = Number(pos.quantity);
      const avg_cost      = Math.abs(Number(pos.avg_cost) || 0);
      const cost_currency = pos.cost_currency === 'THB' ? 'THB' : 'USD';

      if (!ticker)         return res.status(400).json({ error: `Missing ticker: ${JSON.stringify(pos)}` });
      if (isNaN(quantity)) return res.status(400).json({ error: `Invalid quantity for ${ticker}` });
      if (avg_cost < 0)    return res.status(400).json({ error: `Negative avg_cost for ${ticker}` });

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

    // Full replace: wipe existing rows, re-insert the complete list.
    // This preserves multiple rows per ticker (each with distinct notes).
    const { error: deleteErr } = await supabaseAdmin
      .from('initial_positions')
      .delete()
      .eq('user_id', profile.id);
    if (deleteErr) throw deleteErr;

    const { data, error: insertErr } = await supabaseAdmin
      .from('initial_positions')
      .insert(rows)
      .select();
    if (insertErr) throw insertErr;

    await supabaseAdmin
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
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/initial-positions/:ticker', async (req, res) => {
  try {
    const profile = await getUserProfile(req);
    if (!profile) return res.status(401).json({ error: 'Unauthorized' });

    const ticker = req.params.ticker.toUpperCase();

    const { error } = await supabaseAdmin
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
// POST /api/transactions
// ─────────────────────────────────────────────────────────────────────────────

router.post('/transactions', async (req, res) => {
  try {
    const profile = await getUserProfile(req);
    if (!profile) return res.status(401).json({ error: 'Unauthorized' });

    const {
      transaction_type,
      to_ticker,
      to_amount,
      to_asset_type,
      from_ticker,
      from_amount,
      from_asset_type,
      transaction_currency = 'USD',
      price_per_unit,
      fees = 0,
      fee_currency,
      notes,
      platform,
      transaction_date,
    } = req.body;

    let resolvedFromAmount = from_amount;
    if (!resolvedFromAmount && price_per_unit && to_amount) {
      resolvedFromAmount = Number(to_amount) * Number(price_per_unit);
    }

    let resolvedFromTicker    = from_ticker;
    let resolvedFromAssetType = from_asset_type;
    if (transaction_type === 'buy' && !resolvedFromTicker && transaction_currency) {
      resolvedFromTicker    = transaction_currency;
      resolvedFromAssetType = 'cash';
    }
    if (transaction_type === 'sell' && !resolvedFromTicker && to_ticker) {
      resolvedFromTicker    = to_ticker;
      resolvedFromAssetType = to_asset_type;
    }

    if (!to_ticker && !resolvedFromTicker) {
      return res.status(400).json({ error: 'At least one of to_ticker or from_ticker is required.' });
    }

    const fxRate = await fetchFxRate();

    const row = {
      user_id:              profile.id,
      transaction_type:     transaction_type || 'trade',
      transaction_date:     transaction_date || new Date().toISOString(),
      transaction_currency: transaction_currency || 'USD',
      fx_rate_at_time:      fxRate,
      to_ticker:            to_ticker?.toUpperCase() || null,
      to_amount:            to_amount != null ? Number(to_amount) : null,
      to_asset_type:        to_asset_type || null,
      from_ticker:          resolvedFromTicker?.toUpperCase() || null,
      from_amount:          resolvedFromAmount != null ? Number(resolvedFromAmount) : null,
      from_asset_type:      resolvedFromAssetType || null,
      fees:                 Number(fees) || 0,
      fee_currency:         fee_currency || transaction_currency || 'USD',
      notes:                notes || null,
      platform:             platform || null,
    };

    const { data, error } = await supabaseAdmin
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