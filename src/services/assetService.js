// src/services/assetService.js
// Smart caching layer for asset metadata with auto-refresh

import { getBatchAssetMetadata, updateAssetPrice, upsertAssetMetadata } from '../../scripts/assetMetadata.js';
import axios from 'axios';

// Cache TTL: 15 minutes
const PRICE_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Get current price from Yahoo Finance
 */
async function fetchYahooPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      timeout: 5000
    });
    
    const result = response.data?.chart?.result?.[0];
    if (!result) return null;
    
    const price = result.meta?.regularMarketPrice || result.meta?.previousClose;
    const currency = result.meta?.currency || 'USD';
    
    return { price, currency };
  } catch (error) {
    console.error(`⚠️ Failed to fetch Yahoo price for ${ticker}:`, error.message);
    return null;
  }
}

/**
 * Get current price from CoinGecko using coingecko_id
 */
async function fetchCryptoPriceById(coingeckoId) {
  if (!coingeckoId) return null;
  
  try {
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${coingeckoId}&vs_currencies=usd`,
      { timeout: 5000 }
    );
    
    const price = response.data[coingeckoId]?.usd;
    return price ? { price, currency: 'USD' } : null;
  } catch (error) {
    console.error(`⚠️ Failed to fetch crypto price for ${coingeckoId}:`, error.message);
    return null;
  }
}

/**
 * Search CoinGecko for a crypto by symbol and get its ID
 */
async function discoverCoinGeckoId(symbol) {
  try {
    // Remove -USD suffix if present
    const cleanSymbol = symbol.replace(/-USD$/, '').toLowerCase();
    
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/search',
      {
        params: { query: cleanSymbol },
        timeout: 5000
      }
    );
    
    // Find exact symbol match
    const coin = response.data.coins.find(c => 
      c.symbol.toLowerCase() === cleanSymbol
    );
    
    if (coin) {
      console.log(`✅ Discovered CoinGecko ID for ${symbol}: ${coin.id}`);
      return coin.id;
    }
    
    return null;
  } catch (error) {
    console.error(`⚠️ Failed to discover CoinGecko ID for ${symbol}:`, error.message);
    return null;
  }
}

/**
 * Determine if price is stale
 */
function isPriceStale(lastUpdate) {
  if (!lastUpdate) return true;
  
  const now = new Date();
  const lastUpdateDate = new Date(lastUpdate);
  const ageMs = now - lastUpdateDate;
  
  return ageMs > PRICE_CACHE_TTL_MS;
}

/**
 * Refresh price for a single asset
 */
async function refreshAssetPrice(asset) {
  const { ticker, assetType, coingeckoId } = asset;
  
  console.log(`🔄 Refreshing price for ${ticker}...`);
  
  let priceData;
  
  // Try CoinGecko if we have the ID
  if (coingeckoId) {
    priceData = await fetchCryptoPriceById(coingeckoId);
  }
  
  // Fallback to Yahoo Finance
  if (!priceData) {
    priceData = await fetchYahooPrice(ticker);
  }
  
  if (!priceData || !priceData.price) {
    console.error(`❌ Could not fetch price for ${ticker}`);
    return null;
  }
  
  // Update in database
  await updateAssetPrice(ticker, priceData.price, priceData.currency, 'auto-refresh');
  
  return {
    currentPrice: priceData.price,
    priceCurrency: priceData.currency,
    lastPriceUpdate: new Date().toISOString()
  };
}

/**
 * Get asset metadata with automatic price refresh if stale
 */
export async function getAssetWithFreshPrice(ticker) {
  // Fetch from database
  const metadataMap = await getBatchAssetMetadata([ticker]);
  let asset = metadataMap[ticker];
  
  // Asset doesn't exist - try to create it
  if (!asset) {
    console.log(`⚠️ Asset ${ticker} not in metadata, attempting to fetch and create...`);
    
    const priceData = await fetchYahooPrice(ticker);
    if (!priceData) {
      console.error(`❌ Could not fetch data for ${ticker}`);
      return null;
    }
    
    // Infer asset type
    let assetType = 'Stock';
    let coingeckoId = null;
    
    if (ticker.includes('-USD') || ticker.includes('-USDT')) {
      assetType = 'Crypto';
      // Try to discover CoinGecko ID
      coingeckoId = await discoverCoinGeckoId(ticker);
    } else if (ticker.startsWith('CASH-')) {
      assetType = 'Cash';
    }
    
    // Create the asset
    asset = {
      ticker,
      assetName: ticker,
      assetType,
      currentPrice: priceData.price,
      priceCurrency: priceData.currency,
      dataSource: 'auto-created',
      coingeckoId
    };
    
    await upsertAssetMetadata(asset);
    console.log(`✅ Created asset ${ticker} with price ${priceData.price}`);
    
    return asset;
  }
  
  // Check if price is stale
  if (isPriceStale(asset.lastPriceUpdate)) {
    const ageMinutes = Math.round((new Date() - new Date(asset.lastPriceUpdate)) / 60000);
    console.log(`🔄 Price for ${ticker} is stale (${ageMinutes} minutes old), refreshing...`);
    
    const freshPrice = await refreshAssetPrice(asset);
    if (freshPrice) {
      asset = { ...asset, ...freshPrice };
    }
  } else {
    console.log(`✅ Using cached price for ${ticker} (fresh)`);
  }
  
  return asset;
}

/**
 * Get multiple assets with smart batching and selective refresh
 */
export async function getAssetsWithFreshPrices(tickers) {
  console.log(`📊 Fetching metadata for ${tickers.length} assets...`);
  
  // Batch fetch all metadata at once
  const metadataMap = await getBatchAssetMetadata(tickers);
  
  // Identify which assets need price refresh
  const staleAssets = [];
  const missingAssets = [];
  
  tickers.forEach(ticker => {
    const asset = metadataMap[ticker];
    
    if (!asset) {
      missingAssets.push(ticker);
    } else if (isPriceStale(asset.lastPriceUpdate)) {
      staleAssets.push(asset);
    }
  });
  
  console.log(`  → Fresh: ${tickers.length - staleAssets.length - missingAssets.length}`);
  console.log(`  → Stale: ${staleAssets.length}`);
  console.log(`  → Missing: ${missingAssets.length}`);
  
  // Refresh stale prices in parallel
  if (staleAssets.length > 0) {
    console.log(`🔄 Refreshing ${staleAssets.length} stale prices...`);
    
    const refreshPromises = staleAssets.map(async (asset) => {
      const freshPrice = await refreshAssetPrice(asset);
      if (freshPrice) {
        metadataMap[asset.ticker] = { ...metadataMap[asset.ticker], ...freshPrice };
      }
    });
    
    await Promise.all(refreshPromises);
  }
  
  // Handle missing assets
  if (missingAssets.length > 0) {
    console.log(`⚠️ Creating ${missingAssets.length} missing assets...`);
    
    const createPromises = missingAssets.map(async (ticker) => {
      const asset = await getAssetWithFreshPrice(ticker);
      if (asset) {
        metadataMap[ticker] = asset;
      }
    });
    
    await Promise.all(createPromises);
  }
  
  return metadataMap;
}

/**
 * Search assets with autocomplete
 */
export async function searchAssets(query, limit = 10) {
  // Import directly from assetMetadata
  const { searchAssets: dbSearchAssets } = await import('../../scripts/assetMetadata.js');
  return dbSearchAssets(query, limit);
}

/**
 * Get or create asset (for transaction form)
 */
export async function getOrCreateAsset(ticker) {
  return getAssetWithFreshPrice(ticker);
}