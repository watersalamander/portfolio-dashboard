// src/server.js
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { getAssetsWithFreshPrices, getOrCreateAsset, searchAssets } from './services/assetService.js';
import path from 'path';
import { fileURLToPath } from 'url';
import portfolioRouter from './routes/portfolioRoute.js';

// ES6 __dirname equivalent
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Serve static files from frontend directory
app.use(express.static(path.join(__dirname, 'frontend')));

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

console.log('🔧 Supabase Configuration:');
console.log('   URL:', process.env.SUPABASE_URL ? '✓ Configured' : '✗ Missing');
console.log('   Key:', process.env.SUPABASE_ANON_KEY ? '✓ Configured' : '✗ Missing');

// ============================================
// SERVE DASHBOARD AT ROOT
// ============================================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'dashboard.html'));
});

// ============================================
// ASSET ENDPOINTS
// ============================================

/**
 * Autocomplete search for assets
 * GET /api/assets/search?q=AAPL
 */
app.get('/api/assets/search', async (req, res) => {
  const { q } = req.query;
  
  if (!q || q.length < 2) {
    return res.json([]);
  }
  
  try {
    const results = await searchAssets(q, 10);
    res.json(results);
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * Get or create single asset
 * POST /api/assets/get-or-create
 * Body: { ticker: "AAPL" }
 */
app.post('/api/assets/get-or-create', async (req, res) => {
  const { ticker } = req.body;
  
  if (!ticker) {
    return res.status(400).json({ error: 'Ticker is required' });
  }
  
  try {
    const asset = await getOrCreateAsset(ticker.toUpperCase());
    
    if (!asset) {
      return res.status(404).json({ 
        error: `Asset ${ticker} not found and could not be created` 
      });
    }
    
    res.json(asset);
  } catch (error) {
    console.error('Get/create asset error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// TRANSACTION ENDPOINTS
// ============================================

/**
 * Submit new transaction
 * POST /api/transactions
 */
app.post('/api/transactions', async (req, res) => {
  const { 
    ticker, 
    amount, 
    transactionType,
    assetName,
    assetType,
    fromTicker,
    fromAmount,
    notes
  } = req.body;
  
  try {
    // TODO: Get user from auth
    const { data: users } = await supabase
      .from('profiles')
      .select('id')
      .limit(1);
    
    if (!users || users.length === 0) {
      return res.status(404).json({ error: 'No users found' });
    }
    
    const userId = users[0].id;
    
    // Ensure asset exists in asset_metadata (FK constraint)
    const asset = await getOrCreateAsset(ticker);
    if (!asset) {
      return res.status(400).json({ 
        error: `Invalid ticker: ${ticker}` 
      });
    }
    
    // If swap/trade, ensure from_ticker exists too
    if (fromTicker) {
      const fromAsset = await getOrCreateAsset(fromTicker);
      if (!fromAsset) {
        return res.status(400).json({ 
          error: `Invalid from_ticker: ${fromTicker}` 
        });
      }
    }
    
    // Insert transaction
    const { data, error } = await supabase
      .from('transactions')
      .insert({
        user_id: userId,
        transaction_date: new Date().toISOString(),
        transaction_type: transactionType,
        to_ticker: ticker,
        to_amount: amount,
        to_asset_type: assetType || asset.assetType,
        from_ticker: fromTicker || null,
        from_amount: fromAmount || null,
        from_asset_type: fromTicker ? assetType : null,
        notes: notes || null
      })
      .select();
    
    if (error) throw error;
    
    console.log(`✅ Transaction created: ${ticker} - ${amount}`);
    res.json({ success: true, transaction: data[0] });
    
  } catch (error) {
    console.error('❌ Transaction error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,
      cwd: process.cwd(),
      __dirname: __dirname
    },
    supabase: {
      url: process.env.SUPABASE_URL ? 'configured' : 'missing',
      key: process.env.SUPABASE_ANON_KEY ? 'configured' : 'missing'
    },
    files: {
      dashboardPath: path.join(__dirname, 'frontend', 'dashboard.html'),
      staticPath: path.join(__dirname, 'frontend')
    }
  });
});

app.use('/api', portfolioRouter);

app.get('/onboarding', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'onboarding.html'));
});

// TEST ENDPOINT - Remove this after debugging
app.get('/api/test', (req, res) => {
  res.json({ message: 'Router is working!' });
});

// ============================================
// ERROR HANDLING
// ============================================

// 404 handler
app.use((req, res, next) => {
  console.log(`⚠️ 404: ${req.method} ${req.url}`);
  res.status(404).json({
    error: 'Not Found',
    path: req.url,
    message: `Cannot ${req.method} ${req.url}`
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('❌ Unhandled error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// ============================================
// START SERVER
// ============================================

app.listen(PORT, () => {
  console.log('='.repeat(60));
  console.log('🚀 Portfolio Tracker Server Started');
  console.log('='.repeat(60));
  console.log(`📍 Local:      http://localhost:${PORT}`);
  console.log(`📊 Dashboard:  http://localhost:${PORT}/`);
  console.log(`📁 Static:     ${path.join(__dirname, 'frontend')}`);
  console.log('');
  console.log('API Endpoints:');
  console.log(`   GET  /api/health           - Health check`);
  console.log(`   GET  /api/portfolio        - Get portfolio data`);
  console.log(`   GET  /api/assets/search    - Search assets`);
  console.log(`   POST /api/assets/get-or-create - Get/create asset`);
  console.log(`   POST /api/transactions     - Submit transaction`);
  console.log('='.repeat(60));
  console.log('\n✨ Ready to track your portfolio!\n');
});