import { getBitcoinPrice } from './bitcoin.js';
import { 
  getHoldings, 
  calculatePortfolioValue, 
  savePortfolioSnapshot,
  getPortfolioSnapshots 
} from './database.js';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Update dashboard with latest data
async function updateDashboard() {
  try {
    // Get current Bitcoin price
    const btcPrice = await getBitcoinPrice();
    
    // Calculate portfolio metrics
    const metrics = await calculatePortfolioValue(btcPrice);
    
    // Save snapshot to database
    await savePortfolioSnapshot({
      btc_price: btcPrice,
      total_btc: metrics.totalBtc,
      portfolio_value: metrics.portfolioValue,
      profit_loss: metrics.profitLoss
    });

    return {
      btcPrice,
      ...metrics
    };
  } catch (error) {
    console.error('Error updating dashboard:', error);
    throw error;
  }
}

// Get dashboard data (current state)
async function getDashboardData() {
  try {
    const btcPrice = await getBitcoinPrice();
    const metrics = await calculatePortfolioValue(btcPrice);
    const holdings = await getHoldings();

    return {
      btcPrice,
      holdings,
      ...metrics
    };
  } catch (error) {
    console.error('Error getting dashboard data:', error);
    throw error;
  }
}

// Get historical portfolio performance
async function getPortfolioHistory(days = 30) {
  try {
    const snapshots = await getPortfolioSnapshots(days);
    return snapshots;
  } catch (error) {
    console.error('Error getting portfolio history:', error);
    throw error;
  }
}

export {
  updateDashboard,
  getDashboardData,
  getPortfolioHistory
};