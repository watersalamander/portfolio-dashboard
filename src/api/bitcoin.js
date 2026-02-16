const COINGECKO_API = 'https://api.coingecko.com/api/v3';

/**
 * Get current Bitcoin price in USD
 */
export async function getBitcoinPrice() {
  try {
    const response = await fetch(
      `${COINGECKO_API}/simple/price?ids=bitcoin&vs_currencies=usd`
    );
    const data = await response.json();
    return data.bitcoin.usd;
  } catch (error) {
    console.error('Error fetching Bitcoin price:', error);
    throw new Error('Failed to fetch Bitcoin price');
  }
}

/**
 * Get Bitcoin price history
 * @param {number} days - Number of days of history (default: 365)
 */
export async function getBitcoinHistory(days = 365) {
  try {
    const response = await fetch(
      `${COINGECKO_API}/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`
    );
    const data = await response.json();
    
    // Format: array of [timestamp, price]
    return data.prices.map(([timestamp, price]) => ({
      timestamp: new Date(timestamp),
      price: price
    }));
  } catch (error) {
    console.error('Error fetching Bitcoin history:', error);
    throw new Error('Failed to fetch Bitcoin history');
  }
}