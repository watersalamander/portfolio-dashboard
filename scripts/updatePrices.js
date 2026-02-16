// updatePrices.js
// Run this periodically to keep prices fresh

import { getStaleAssets, updateAssetPrice } from './assetMetadata.js';
import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function getYahooPrice(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
    const response = await axios.get(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    const result = response.data?.chart?.result?.[0];
    if (!result) return null;
    
    return {
      price: result.meta?.regularMarketPrice || result.meta?.previousClose,
      currency: result.meta?.currency || 'USD'
    };
  } catch {
    return null;
  }
}

async function getCryptoPrice(ticker) {
  try {
    // Extract symbol from ticker (e.g., "BTC-USD" -> "BTC")
    const symbol = ticker.split('-')[0].toLowerCase();
    
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${symbol}&vs_currencies=usd`
    );
    
    return {
      price: response.data[symbol]?.usd,
      currency: 'USD'
    };
  } catch {
    return null;
  }
}

async function updateAllStalePrices(hoursOld = 24) {
  console.log(`🔄 Updating prices older than ${hoursOld} hours...\n`);
  
  const staleAssets = await getStaleAssets(hoursOld);
  
  if (staleAssets.length === 0) {
    console.log('✅ All prices are fresh!');
    return;
  }
  
  console.log(`Found ${staleAssets.length} stale assets to update`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const asset of staleAssets) {
    try {
      let priceData;
      
      // Try crypto API first for crypto assets
      if (asset.ticker.includes('-USD') || asset.ticker.includes('-USDT')) {
        priceData = await getCryptoPrice(asset.ticker);
        await delay(1500); // CoinGecko rate limit
      }
      
      // Fallback to Yahoo for everything
      if (!priceData || !priceData.price) {
        priceData = await getYahooPrice(asset.ticker);
        await delay(200); // Yahoo rate limit
      }
      
      if (priceData && priceData.price) {
        await updateAssetPrice(
          asset.ticker,
          priceData.price,
          priceData.currency,
          'auto-update'
        );
        successCount++;
        console.log(`✅ ${asset.ticker}: ${priceData.price} ${priceData.currency}`);
      } else {
        errorCount++;
        console.log(`⚠️ ${asset.ticker}: No price available`);
      }
      
    } catch (error) {
      errorCount++;
      console.error(`❌ ${asset.ticker}:`, error.message);
    }
  }
  
  console.log('\n' + '='.repeat(50));
  console.log(`✅ Update complete!`);
  console.log(`   Successful: ${successCount}`);
  console.log(`   Errors: ${errorCount}`);
  console.log(`   Total: ${staleAssets.length}`);
  console.log('='.repeat(50));
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const hours = parseInt(process.argv[2]) || 24;
  updateAllStalePrices(hours)
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

export { updateAllStalePrices };