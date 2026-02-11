// API base URL
const API_BASE = 'http://localhost:3000/api';

// DOM elements
const btcPriceEl = document.getElementById('btc-price');
const portfolioValueEl = document.getElementById('portfolio-value');
const btcHeldEl = document.getElementById('btc-held');
const profitLossEl = document.getElementById('profit-loss');
const lastUpdateEl = document.getElementById('last-update');
const refreshBtn = document.getElementById('refresh-btn');
const holdingsTableEl = document.getElementById('holdings-table');

// Chart instance
let priceChart = null;

// Format currency
function formatCurrency(value) {
  return '$' + value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Format BTC amount
function formatBTC(value) {
  return value.toFixed(8) + ' BTC';
}

// Fetch Bitcoin price
async function fetchBitcoinPrice() {
  try {
    const response = await fetch(`${API_BASE}/bitcoin/price`);
    const data = await response.json();
    return data.price;
  } catch (error) {
    console.error('Error fetching Bitcoin price:', error);
    return null;
  }
}

// Fetch dashboard data
async function fetchDashboardData() {
  try {
    const response = await fetch(`${API_BASE}/dashboard`);
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error fetching dashboard data:', error);
    return null;
  }
}

// Fetch price history
async function fetchPriceHistory(days = 30) {
  try {
    const response = await fetch(`${API_BASE}/bitcoin/history?days=${days}`);
    const data = await response.json();
    return data.history;
  } catch (error) {
    console.error('Error fetching price history:', error);
    return null;
  }
}

// Update dashboard UI
async function updateDashboard() {
  try {
    refreshBtn.disabled = true;
    refreshBtn.textContent = '⏳ Loading...';

    // Fetch all data
    const [btcPrice, dashboardData, priceHistory] = await Promise.all([
      fetchBitcoinPrice(),
      fetchDashboardData(),
      fetchPriceHistory(30)
    ]);

    // Update Bitcoin price
    if (btcPrice) {
      btcPriceEl.textContent = formatCurrency(btcPrice);
    } else {
      btcPriceEl.textContent = 'Error';
    }

    // Update dashboard stats
    if (dashboardData) {
      portfolioValueEl.textContent = formatCurrency(dashboardData.portfolioValue || 0);
      btcHeldEl.textContent = formatBTC(dashboardData.totalBtc || 0);
      
      const profitLoss = dashboardData.profitLoss || 0;
      profitLossEl.textContent = formatCurrency(profitLoss);
      profitLossEl.className = 'stat-value ' + (profitLoss >= 0 ? 'positive' : 'negative');

      // Update holdings table
      if (dashboardData.holdings && dashboardData.holdings.length > 0) {
        renderHoldingsTable(dashboardData.holdings);
      } else {
        holdingsTableEl.innerHTML = '<p class="loading">No holdings yet. Add some transactions!</p>';
      }
    } else {
      portfolioValueEl.textContent = '$0.00';
      btcHeldEl.textContent = '0.00000000 BTC';
      profitLossEl.textContent = '$0.00';
      holdingsTableEl.innerHTML = '<p class="loading">No data available</p>';
    }

    // Update chart
    if (priceHistory && priceHistory.length > 0) {
      updateChart(priceHistory);
    }

    // Update timestamp
    lastUpdateEl.textContent = new Date().toLocaleString();

    refreshBtn.disabled = false;
    refreshBtn.textContent = '🔄 Refresh Data';
  } catch (error) {
    console.error('Error updating dashboard:', error);
    
    btcPriceEl.textContent = 'Error';
    portfolioValueEl.textContent = 'Error';
    btcHeldEl.textContent = 'Error';
    profitLossEl.textContent = 'Error';
    holdingsTableEl.innerHTML = '<div class="error">Failed to load dashboard. Check console for details.</div>';
    
    refreshBtn.disabled = false;
    refreshBtn.textContent = '🔄 Refresh Data';
  }
}

// Render holdings table
function renderHoldingsTable(holdings) {
  const html = `
    <table>
      <thead>
        <tr>
          <th>Asset</th>
          <th>Ticker</th>
          <th>Type</th>
          <th>Quantity</th>
          <th>Avg Cost</th>
          <th>Current Price</th>
          <th>Value</th>
          <th>P&L</th>
        </tr>
      </thead>
      <tbody>
        ${holdings.map(holding => {
          const value = holding.current_value || 0;
          const pnl = holding.unrealized_pnl || 0;
          const pnlClass = pnl >= 0 ? 'positive' : 'negative';
          
          return `
            <tr>
              <td><strong>${holding.asset_name || holding.ticker}</strong></td>
              <td>${holding.ticker}</td>
              <td>${holding.asset_type}</td>
              <td>${parseFloat(holding.quantity).toFixed(8)}</td>
              <td>${formatCurrency(holding.average_cost || 0)}</td>
              <td>${formatCurrency(holding.current_price || 0)}</td>
              <td>${formatCurrency(value)}</td>
              <td class="${pnlClass}">${formatCurrency(pnl)}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;
  
  holdingsTableEl.innerHTML = html;
}

// Update price chart
function updateChart(priceData) {
  const ctx = document.getElementById('price-chart').getContext('2d');

  // Prepare data for Chart.js
  const labels = priceData.map(([timestamp]) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  });

  const prices = priceData.map(([, price]) => price);

  // Destroy existing chart if any
  if (priceChart) {
    priceChart.destroy();
  }

  // Create new chart
  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Bitcoin Price (USD)',
        data: prices,
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        tension: 0.4,
        fill: true,
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      plugins: {
        legend: {
          display: true,
          position: 'top'
        },
        tooltip: {
          mode: 'index',
          intersect: false,
          callbacks: {
            label: function(context) {
              return 'Price: ' + formatCurrency(context.parsed.y);
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: false,
          ticks: {
            callback: function(value) {
              return '$' + value.toLocaleString();
            }
          }
        }
      }
    }
  });
}

// Event listeners
refreshBtn.addEventListener('click', updateDashboard);

// Initial load
console.log('Dashboard loading...');
updateDashboard();