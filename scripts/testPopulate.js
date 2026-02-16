import { upsertAssetMetadata } from './assetMetadata.js';
import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', '.env') });

console.log('🧪 Testing population functions...\n');

// Test 1: Upsert a single asset manually
async function testManualUpsert() {
  console.log('📝 Test 1: Manual asset upsert...');
  
  const testAsset = {
    ticker: 'AAPL',
    assetName: 'Apple Inc.',
    assetType: 'Stock',
    currentPrice: 178.25,
    priceCurrency: 'USD',
    description: 'Apple Inc. - Technology company',
    dataSource: 'manual'
  };
  
  const result = await upsertAssetMetadata(testAsset);
  
  if (result) {
    console.log('✅ Asset upserted successfully!');
    console.log('   Result:', result);
  } else {
    console.log('❌ Failed to upsert');
  }
  
  console.log('');
}

// Test 2: Fetch crypto data from CoinGecko
async function testCryptoFetch() {
  console.log('🪙 Test 2: Fetching crypto from CoinGecko...');
  
  try {
    const response = await axios.get(
      'https://api.coingecko.com/api/v3/coins/markets',
      {
        params: {
          vs_currency: 'usd',
          order: 'market_cap_desc',
          per_page: 5,
          page: 1,
          sparkline: false
        }
      }
    );
    
    console.log('✅ Fetched', response.data.length, 'cryptocurrencies');
    
    // Upsert first 3
    for (const coin of response.data.slice(0, 3)) {
      const crypto = {
        ticker: `${coin.symbol.toUpperCase()}-USD`,
        assetName: coin.name,
        assetType: 'Crypto',
        currentPrice: coin.current_price,
        priceCurrency: 'USD',
        description: `${coin.name} - Rank #${coin.market_cap_rank}`,
        logoUrl: coin.image,
        dataSource: 'coingecko'
      };
      
      const result = await upsertAssetMetadata(crypto);
      if (result) {
        console.log(`   ✅ ${crypto.ticker}: ${crypto.assetName} - $${crypto.currentPrice}`);
      } else {
        console.log(`   ❌ Failed to upsert ${crypto.ticker}`);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  console.log('');
}

// Test 3: Fetch stock price from Yahoo
async function testYahooFetch() {
  console.log('📊 Test 3: Fetching stock from Yahoo Finance...');
  
  try {
    const ticker = 'MSFT';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      }
    });
    
    const result = response.data?.chart?.result?.[0];
    if (result) {
      const price = result.meta?.regularMarketPrice || result.meta?.previousClose;
      const currency = result.meta?.currency || 'USD';
      
      console.log(`✅ ${ticker} Price: ${price} ${currency}`);
      
      // Upsert it
      const stock = {
        ticker: ticker,
        assetName: 'Microsoft Corporation',
        assetType: 'Stock',
        currentPrice: price,
        priceCurrency: currency,
        description: 'Microsoft Corporation - Technology sector',
        dataSource: 'yahoo'
      };
      
      const upsertResult = await upsertAssetMetadata(stock);
      if (upsertResult) {
        console.log('   ✅ Upserted to Supabase');
      } else {
        console.log('   ❌ Failed to upsert');
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  console.log('');
}

// Run all tests
async function runTests() {
  await testManualUpsert();
  await testCryptoFetch();
  await testYahooFetch();
  
  console.log('✅ All tests completed!');
  console.log('\nCheck your Supabase dashboard to verify the data.');
}

runTests()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });