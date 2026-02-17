// populateAssets.js
// Script to populate asset_metadata with S&P500, Top 100 Crypto, and SET100

import { upsertAssetMetadata } from './assetMetadata.js';
import axios from 'axios';
import * as cheerio from 'cheerio';
import dotenv from 'dotenv';

dotenv.config();

// Add delay between requests to avoid rate limiting
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// ============================================
// S&P 500 STOCKS
// ============================================

/**
 * Fetch S&P 500 constituents from Wikipedia
 * @returns {Promise<Array>} Array of S&P 500 stocks
 */
async function fetchSP500Stocks() {
  console.log('📊 Fetching S&P 500 stocks...');
  
  try {
    const response = await axios.get(
      'https://en.wikipedia.org/wiki/List_of_S%26P_500_companies',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate, br',
          'Connection': 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
          'Cache-Control': 'max-age=0'
        },
        timeout: 10000
      }
    );
    
    const $ = cheerio.load(response.data);
    const stocks = [];
    
    // Wikipedia table has ticker in first column, company name in second, sector in fourth
    $('#constituents tbody tr').each((index, element) => {
      const cells = $(element).find('td');
      if (cells.length >= 4) {
        const ticker = $(cells[0]).text().trim();
        const companyName = $(cells[1]).text().trim();
        const sector = $(cells[3]).text().trim();
        
        if (ticker && companyName) {
          stocks.push({
            ticker: ticker,
            assetName: companyName,
            assetType: 'Stock',
            sector: sector,
            description: `${companyName} - ${sector} sector company in S&P 500`
          });
        }
      }
    });
    
    console.log(`✅ Found ${stocks.length} S&P 500 stocks`);
    return stocks;
  } catch (error) {
    console.error('❌ Error fetching S&P 500:', error.message);
    return [];
  }
}

/**
 * Get current price for a stock using Yahoo Finance API
 * @param {string} ticker - Stock ticker
 * @returns {Promise<Object|null>} Price data
 */
async function getYahooStockPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const result = response.data?.chart?.result?.[0];
    if (!result) return null;
    
    const price = result.meta?.regularMarketPrice || result.meta?.previousClose;
    const currency = result.meta?.currency || 'USD';
    
    return {
      price: price,
      currency: currency,
      dataSource: 'yahoo'
    };
  } catch (error) {
    console.error(`⚠️ Error fetching price for ${ticker}:`, error.message);
    return null;
  }
}

// ============================================
// TOP 100 CRYPTOCURRENCIES
// ============================================

/**
 * Fetch top 100 cryptocurrencies from CoinGecko (free API, no key required)
 * @returns {Promise<Array>} Array of top 100 cryptos
 */
async function fetchTop100Crypto() {
  console.log('🪙 Fetching top 100 cryptocurrencies...');
  
  try {
    // CoinGecko free API - no key required
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets',
      {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 100,
          page: 1,
          sparkline: false
        }
      }
    );
    
    const cryptos = response.data.map(coin => ({
      ticker: `${coin.symbol.toUpperCase()}-USD`,
      assetName: coin.name,
      assetType: 'Crypto',
      currentPrice: coin.current_price,
      priceCurrency: 'USD',
      description: `${coin.name} (${coin.symbol.toUpperCase()}) - Rank #${coin.market_cap_rank} by market cap`,
      logoUrl: coin.image,
      dataSource: 'coingecko',
      coingeckoId: coin.id,
      marketCapRank: coin.market_cap_rank,
      marketCap: coin.market_cap
    }));
    
    console.log(`✅ Found ${cryptos.length} cryptocurrencies`);
    return cryptos;
  } catch (error) {
    console.error('❌ Error fetching crypto data:', error.message);
    return [];
  }
}

// ============================================
// SET100 (Thai Stock Market)
// ============================================

/**
 * Fetch SET100 constituents
 * @returns {Promise<Array>} Array of SET100 stocks
 */
async function fetchSET100Stocks() {
  console.log('🇹🇭 Fetching SET100 stocks...');
  
  try {
    // Scrape from SET website
    const response = await axios.get(
      'https://www.set.or.th/en/market/index/set100/constituents',
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    
    const $ = cheerio.load(response.data);
    const stocks = [];
    
    // Parse the table (structure may vary, adjust selectors as needed)
    $('table tbody tr').each((index, element) => {
      const cells = $(element).find('td');
      if (cells.length >= 2) {
        const symbol = $(cells[0]).text().trim();
        const companyName = $(cells[1]).text().trim();
        
        if (symbol && companyName) {
          stocks.push({
            ticker: `${symbol}.BK`,
            assetName: companyName,
            assetType: 'Stock',
            description: `${companyName} - SET100 constituent`
          });
        }
      }
    });
    
    // If scraping fails, use a hardcoded list of major SET100 stocks
    if (stocks.length === 0) {
      console.log('⚠️ Scraping failed, using fallback list of major SET100 stocks');
      stocks.push(
        ...getMajorSET100Stocks()
      );
    }
    
    console.log(`✅ Found ${stocks.length} SET100 stocks`);
    return stocks;
  } catch (error) {
    console.error('❌ Error fetching SET100:', error.message);
    console.log('Using fallback list of major SET100 stocks');
    return getMajorSET100Stocks();
  }
}

/**
 * Fallback list of major SET100 stocks (top 30 by market cap)
 */
function getMajorSET100Stocks() {
  return [
    { ticker: 'PTT.BK', assetName: 'PTT Public Company Limited', assetType: 'Stock' },
    { ticker: 'CPALL.BK', assetName: 'CP ALL Public Company Limited', assetType: 'Stock' },
    { ticker: 'ADVANC.BK', assetName: 'Advanced Info Service Public Company Limited', assetType: 'Stock' },
    { ticker: 'AOT.BK', assetName: 'Airports of Thailand Public Company Limited', assetType: 'Stock' },
    { ticker: 'BBL.BK', assetName: 'Bangkok Bank Public Company Limited', assetType: 'Stock' },
    { ticker: 'KBANK.BK', assetName: 'Kasikornbank Public Company Limited', assetType: 'Stock' },
    { ticker: 'SCB.BK', assetName: 'Siam Commercial Bank Public Company Limited', assetType: 'Stock' },
    { ticker: 'TRUE.BK', assetName: 'True Corporation Public Company Limited', assetType: 'Stock' },
    { ticker: 'PTTEP.BK', assetName: 'PTT Exploration and Production Public Company Limited', assetType: 'Stock' },
    { ticker: 'PTTGC.BK', assetName: 'PTT Global Chemical Public Company Limited', assetType: 'Stock' },
    { ticker: 'TOP.BK', assetName: 'Thai Oil Public Company Limited', assetType: 'Stock' },
    { ticker: 'SCC.BK', assetName: 'The Siam Cement Public Company Limited', assetType: 'Stock' },
    { ticker: 'BDMS.BK', assetName: 'Bangkok Dusit Medical Services Public Company Limited', assetType: 'Stock' },
    { ticker: 'BCP.BK', assetName: 'Bangchak Corporation Public Company Limited', assetType: 'Stock' },
    { ticker: 'BEM.BK', assetName: 'Bangkok Expressway and Metro Public Company Limited', assetType: 'Stock' },
    { ticker: 'EGCO.BK', assetName: 'Electricity Generating Public Company Limited', assetType: 'Stock' },
    { ticker: 'GULF.BK', assetName: 'Gulf Energy Development Public Company Limited', assetType: 'Stock' },
    { ticker: 'INTUCH.BK', assetName: 'Intouch Holdings Public Company Limited', assetType: 'Stock' },
    { ticker: 'IVL.BK', assetName: 'Indorama Ventures Public Company Limited', assetType: 'Stock' },
    { ticker: 'LH.BK', assetName: 'Land and Houses Public Company Limited', assetType: 'Stock' },
    { ticker: 'MTC.BK', assetName: 'Muangthai Capital Public Company Limited', assetType: 'Stock' },
    { ticker: 'OR.BK', assetName: 'PTT Oil and Retail Business Public Company Limited', assetType: 'Stock' },
    { ticker: 'RATCH.BK', assetName: 'Ratchaburi Electricity Generating Holding Public Company Limited', assetType: 'Stock' },
    { ticker: 'SAWAD.BK', assetName: 'Srisawad Corporation Public Company Limited', assetType: 'Stock' },
    { ticker: 'TISCO.BK', assetName: 'Tisco Financial Group Public Company Limited', assetType: 'Stock' },
    { ticker: 'TTB.BK', assetName: 'TMBThanachart Bank Public Company Limited', assetType: 'Stock' },
    { ticker: 'WHA.BK', assetName: 'WHA Corporation Public Company Limited', assetType: 'Stock' },
    { ticker: 'BANPU.BK', assetName: 'Banpu Public Company Limited', assetType: 'Stock' },
    { ticker: 'BH.BK', assetName: 'Bumrungrad Hospital Public Company Limited', assetType: 'Stock' },
    { ticker: 'CPN.BK', assetName: 'Central Pattana Public Company Limited', assetType: 'Stock' }
  ];
}

// ============================================
// MAIN POPULATION FUNCTION
// ============================================

/**
 * Populate all assets into Supabase
 * @param {Object} options - Configuration options
 */
async function populateAllAssets(options = {}) {
  const {
    includeSP500 = true,
    includeCrypto = true,
    includeSET100 = true,
    fetchPrices = true,
    batchSize = 10 // Process N assets at a time to avoid rate limits
  } = options;
  
  console.log('🚀 Starting asset population...\n');
  
  let allAssets = [];
  
  // Fetch all asset lists
  if (includeSP500) {
    const sp500 = await fetchSP500Stocks();
    allAssets.push(...sp500);
    await delay(1000); // Be nice to Wikipedia
  }
  
  if (includeCrypto) {
    const crypto = await fetchTop100Crypto();
    allAssets.push(...crypto);
    await delay(1000); // Be nice to CoinGecko
  }
  
  if (includeSET100) {
    const set100 = await fetchSET100Stocks();
    allAssets.push(...set100);
    await delay(1000);
  }
  
  console.log(`\n📊 Total assets to process: ${allAssets.length}`);
  console.log(`   - S&P 500: ${allAssets.filter(a => a.assetType === 'Stock' && !a.ticker.endsWith('.BK')).length}`);
  console.log(`   - Crypto: ${allAssets.filter(a => a.assetType === 'Crypto').length}`);
  console.log(`   - SET100: ${allAssets.filter(a => a.ticker.endsWith('.BK')).length}`);
  console.log('');
  
  // Process in batches
  let successCount = 0;
  let errorCount = 0;
  
  for (let i = 0; i < allAssets.length; i += batchSize) {
    const batch = allAssets.slice(i, i + batchSize);
    console.log(`\n🔄 Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(allAssets.length / batchSize)} (${i + 1}-${Math.min(i + batchSize, allAssets.length)} of ${allAssets.length})`);
    
    await Promise.all(
      batch.map(async (asset) => {
        try {
          // Fetch current price if needed and not already provided (crypto already has prices)
          let assetData = { ...asset };
          
          if (fetchPrices && !asset.currentPrice) {
            if (asset.assetType === 'Stock') {
              const priceData = await getYahooStockPrice(asset.ticker);
              if (priceData) {
                assetData.currentPrice = priceData.price;
                assetData.priceCurrency = priceData.currency;
                assetData.dataSource = priceData.dataSource;
              }
              await delay(200); // Rate limit for Yahoo Finance
            }
          }
          
          // Upsert to Supabase
          const result = await upsertAssetMetadata(assetData);
          
          if (result) {
            successCount++;
            console.log(`  ✅ ${asset.ticker} - ${asset.assetName}`);
          } else {
            errorCount++;
            console.log(`  ❌ ${asset.ticker} - Failed to upsert`);
          }
          
        } catch (error) {
          errorCount++;
          console.error(`  ❌ ${asset.ticker} - Error:`, error.message);
        }
      })
    );
    
    // Progress update
    console.log(`  Progress: ${Math.min(i + batchSize, allAssets.length)}/${allAssets.length} (${((Math.min(i + batchSize, allAssets.length) / allAssets.length) * 100).toFixed(1)}%)`);
    
    // Delay between batches
    if (i + batchSize < allAssets.length) {
      await delay(2000);
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('✅ Asset population complete!');
  console.log(`   Successful: ${successCount}`);
  console.log(`   Errors: ${errorCount}`);
  console.log(`   Total: ${allAssets.length}`);
  console.log('='.repeat(50));
  
  return {
    total: allAssets.length,
    successful: successCount,
    errors: errorCount
  };
}

// ============================================
// CLI EXECUTION - WINDOWS-COMPATIBLE VERSION
// ============================================

// Convert paths for comparison (Windows compatibility)
function normalizeUrl(url) {
  return url.replace(/\\/g, '/').toLowerCase();
}

// Check if this script is being run directly
const isMainModule = process.argv[1] && 
  normalizeUrl(import.meta.url).endsWith(normalizeUrl(process.argv[1]));

console.log('🔍 Debug Info:');
console.log('import.meta.url:', import.meta.url);
console.log('process.argv[1]:', process.argv[1]);
console.log('isMainModule:', isMainModule);
console.log('');

// Run if called directly OR if no other module check passed
if (isMainModule || process.argv[1]?.includes('populateAssets')) {
  const args = process.argv.slice(2);
  
  const options = {
    includeSP500: !args.includes('--no-sp500'),
    includeCrypto: !args.includes('--no-crypto'),
    includeSET100: !args.includes('--no-set100'),
    fetchPrices: !args.includes('--no-prices'),
    batchSize: parseInt(args.find(arg => arg.startsWith('--batch='))?.split('=')[1]) || 10
  };
  
  console.log('🎯 Running with configuration:', options);
  console.log('');
  
  populateAllAssets(options)
    .then(result => {
      console.log('\n✅ Script completed successfully!');
      process.exit(0);
    })
    .catch(error => {
      console.error('\n❌ Fatal error:', error);
      console.error('Stack:', error.stack);
      process.exit(1);
    });
} else {
  console.log('ℹ️ Module loaded but not executed (imported by another script)');
}

export { populateAllAssets, fetchSP500Stocks, fetchTop100Crypto, fetchSET100Stocks };