// assetMetadata.js
// Supabase Asset Metadata Integration

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Get the directory name in ES6 modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from project root
dotenv.config({ path: join(__dirname, '..', '.env') });

// Initialize Supabase client from .env
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;

// Debug logging - remove after fixing
console.log('🔍 Checking environment variables:');
console.log('SUPABASE_URL exists:', !!supabaseUrl);
console.log('SUPABASE_ANON_KEY exists:', !!supabaseAnonKey);

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing environment variables!');
  console.error('SUPABASE_URL:', supabaseUrl);
  console.error('SUPABASE_ANON_KEY:', supabaseAnonKey ? '[HIDDEN]' : 'undefined');
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY in .env file');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

console.log('✅ Supabase client initialized successfully\n');

/**
 * Fetch asset metadata for a single ticker
 * @param {string} ticker - Asset ticker symbol
 * @returns {Promise<Object|null>} Asset metadata or null if not found
 */
export async function getAssetMetadata(ticker) {
  try {
    const { data, error } = await supabase
      .from('asset_metadata')
      .select('*')
      .eq('ticker', ticker)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        // No rows returned - asset not in database
        console.log(`ℹ️ Asset ${ticker} not found in metadata`);
        return null;
      }
      throw error;
    }

    return {
      ticker: data.ticker,
      assetName: data.asset_name,
      assetType: data.asset_type,
      currentPrice: data.current_price,
      priceCurrency: data.price_currency,
      lastPriceUpdate: data.last_price_update,
      description: data.description,
      logoUrl: data.logo_url,
      dataSource: data.data_source,
      coingeckoId: data.coingecko_id,
      createdAt: data.created_at,
      updatedAt: data.updated_at
    };
  } catch (error) {
    console.error(`❌ Error fetching metadata for ${ticker}:`, error);
    return null;
  }
}

/**
 * Batch fetch asset metadata for multiple tickers
 * @param {string[]} tickers - Array of ticker symbols
 * @returns {Promise<Object>} Map of ticker -> metadata
 */
export async function getBatchAssetMetadata(tickers) {
  try {
    // Filter out cash positions
    const nonCashTickers = tickers.filter(
      ticker => !ticker.toUpperCase().startsWith('CASH-')
    );

    if (nonCashTickers.length === 0) {
      return {};
    }

    const { data, error } = await supabase
      .from('asset_metadata')
      .select('*')
      .in('ticker', nonCashTickers);

    if (error) throw error;

    // Convert array to map for easy lookup
    const metadataMap = {};
    data.forEach(asset => {
      metadataMap[asset.ticker] = {
        ticker: asset.ticker,
        assetName: asset.asset_name,
        assetType: asset.asset_type,
        currentPrice: asset.current_price,
        priceCurrency: asset.price_currency,
        lastPriceUpdate: asset.last_price_update,
        description: asset.description,
        logoUrl: asset.logo_url,
        dataSource: asset.data_source,
        coingeckId: asset.coingecko_id,
        createdAt: asset.created_at,
        updatedAt: asset.updated_at
      };
    });

    console.log(`✅ Fetched metadata for ${Object.keys(metadataMap).length}/${nonCashTickers.length} assets`);
    
    // Log missing assets
    const foundTickers = Object.keys(metadataMap);
    const missingTickers = nonCashTickers.filter(t => !foundTickers.includes(t));
    if (missingTickers.length > 0) {
      console.log(`⚠️ Missing metadata for: ${missingTickers.join(', ')}`);
    }

    return metadataMap;
  } catch (error) {
    console.error('❌ Error in batch fetch:', error);
    return {};
  }
}

/**
 * Insert or update asset metadata
 * @param {Object} assetData - Asset metadata to upsert
 * @returns {Promise<Object|null>} Upserted data or null
 */
export async function upsertAssetMetadata(assetData) {
  try {
    const { data, error } = await supabase
      .from('asset_metadata')
      .upsert({
        ticker: assetData.ticker,
        asset_name: assetData.assetName,
        asset_type: assetData.assetType,
        current_price: assetData.currentPrice,
        price_currency: assetData.priceCurrency,
        last_price_update: assetData.lastPriceUpdate || new Date().toISOString(),
        description: assetData.description || null,
        logo_url: assetData.logoUrl || null,
        data_source: assetData.dataSource || 'manual',
        coingecko_id: assetData.coingeckoId || null
      }, {
        onConflict: 'ticker'
      })
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Upserted metadata for ${assetData.ticker}`);
    return data;
  } catch (error) {
    console.error(`❌ Error upserting metadata for ${assetData.ticker}:`, error);
    return null;
  }
}

/**
 * Update price for an existing asset
 * @param {string} ticker - Asset ticker
 * @param {number} price - New price
 * @param {string} priceCurrency - Currency of the price (USD, THB, etc.)
 * @param {string} dataSource - Where the price came from
 * @returns {Promise<Object|null>}
 */
export async function updateAssetPrice(ticker, price, priceCurrency, dataSource = 'yahoo') {
  try {
    const { data, error } = await supabase
      .from('asset_metadata')
      .update({
        current_price: price,
        price_currency: priceCurrency,
        last_price_update: new Date().toISOString(),
        data_source: dataSource
      })
      .eq('ticker', ticker)
      .select()
      .single();

    if (error) throw error;

    console.log(`✅ Updated price for ${ticker}: ${price} ${priceCurrency}`);
    return data;
  } catch (error) {
    console.error(`❌ Error updating price for ${ticker}:`, error);
    return null;
  }
}

/**
 * Get current price with fallback to Yahoo Finance
 * @param {string} ticker - Asset ticker
 * @param {Function} yahooFallback - Function to fetch from Yahoo if not in DB
 * @returns {Promise<Object|null>} Price data object
 */
export async function getAssetPrice(ticker, yahooFallback = null) {
  try {
    // Skip for cash positions
    if (ticker.toUpperCase().startsWith('CASH-')) {
      return {
        price: 1.0,
        currency: ticker.includes('THB') ? 'THB' : 'USD',
        source: 'cash',
        lastUpdate: new Date().toISOString()
      };
    }

    // Try Supabase first
    const metadata = await getAssetMetadata(ticker);

    if (metadata && metadata.currentPrice) {
      return {
        price: metadata.currentPrice,
        currency: metadata.priceCurrency,
        source: 'supabase',
        lastUpdate: metadata.lastPriceUpdate,
        assetName: metadata.assetName,
        assetType: metadata.assetType
      };
    }

    // Fallback to Yahoo Finance if provided
    if (yahooFallback) {
      console.log(`⚠️ ${ticker} not in Supabase, using fallback`);
      const yahooPrice = await yahooFallback(ticker);
      
      if (yahooPrice) {
        // Infer currency from ticker
        let currency = 'USD';
        if (ticker.endsWith('.BK')) currency = 'THB';
        else if (ticker.toUpperCase().includes('THB')) currency = 'THB';

        return {
          price: yahooPrice,
          currency: currency,
          source: 'yahoo',
          lastUpdate: new Date().toISOString()
        };
      }
    }

    return null;
  } catch (error) {
    console.error(`❌ Error getting price for ${ticker}:`, error);
    return null;
  }
}

/**
 * Search assets by name or ticker
 * @param {string} searchTerm - Search term
 * @param {number} limit - Max results
 * @returns {Promise<Array>} Array of matching assets
 */
export async function searchAssets(searchTerm, limit = 10) {
  try {
    const { data, error } = await supabase
      .from('asset_metadata')
      .select('ticker, asset_name, asset_type, current_price, price_currency')
      .or(`ticker.ilike.%${searchTerm}%,asset_name.ilike.%${searchTerm}%`)
      .limit(limit);

    if (error) throw error;

    return data.map(asset => ({
      ticker: asset.ticker,
      assetName: asset.asset_name,
      assetType: asset.asset_type,
      currentPrice: asset.current_price,
      priceCurrency: asset.price_currency
    }));
  } catch (error) {
    console.error('❌ Error searching assets:', error);
    return [];
  }
}

/**
 * Get all assets by type
 * @param {string} assetType - Asset type (Stock, Crypto, ETF, etc.)
 * @returns {Promise<Array>} Array of assets
 */
export async function getAssetsByType(assetType) {
  try {
    const { data, error } = await supabase
      .from('asset_metadata')
      .select('*')
      .eq('asset_type', assetType)
      .order('ticker');

    if (error) throw error;

    return data.map(asset => ({
      ticker: asset.ticker,
      assetName: asset.asset_name,
      assetType: asset.asset_type,
      currentPrice: asset.current_price,
      priceCurrency: asset.price_currency,
      lastPriceUpdate: asset.last_price_update
    }));
  } catch (error) {
    console.error(`❌ Error getting assets by type ${assetType}:`, error);
    return [];
  }
}

/**
 * Delete asset metadata
 * @param {string} ticker - Ticker to delete
 * @returns {Promise<boolean>} Success status
 */
export async function deleteAssetMetadata(ticker) {
  try {
    const { error } = await supabase
      .from('asset_metadata')
      .delete()
      .eq('ticker', ticker);

    if (error) throw error;

    console.log(`✅ Deleted metadata for ${ticker}`);
    return true;
  } catch (error) {
    console.error(`❌ Error deleting metadata for ${ticker}:`, error);
    return false;
  }
}

/**
 * Get stale assets (prices older than specified hours)
 * @param {number} hoursOld - How many hours old constitutes "stale"
 * @returns {Promise<Array>} Array of stale assets
 */
export async function getStaleAssets(hoursOld = 24) {
  try {
    const cutoffTime = new Date();
    cutoffTime.setHours(cutoffTime.getHours() - hoursOld);

    const { data, error } = await supabase
      .from('asset_metadata')
      .select('ticker, asset_name, last_price_update, current_price, price_currency')
      .lt('last_price_update', cutoffTime.toISOString())
      .order('last_price_update');

    if (error) throw error;

    console.log(`📊 Found ${data.length} stale assets (older than ${hoursOld}h)`);
    return data;
  } catch (error) {
    console.error('❌ Error getting stale assets:', error);
    return [];
  }
}

export default {
  getAssetMetadata,
  getBatchAssetMetadata,
  upsertAssetMetadata,
  updateAssetPrice,
  getAssetPrice,
  searchAssets,
  getAssetsByType,
  deleteAssetMetadata,
  getStaleAssets
};