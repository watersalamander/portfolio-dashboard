// API base URL
const API_BASE = 'http://localhost:3000/api';

// DOM elements
const btcPriceEl = document.getElementById('btc-price');
const portfolioValueEl = document.getElementById('portfolio-value');
const btcHeldEl = document.getElementById('btc-held');
const profitLossEl = document.getElementById('profit-loss');
const lastUpdateEl = document.getElementById('last-update');
const refreshBtn = document.getElementById('refresh-btn');

// Chart instances
let priceChart = null;
let portfolioChart = null;

// Fetch Bitcoin price
async function fetchBitcoinPrice() {
  const response = await fetch(`${API_BASE}/bitcoin/price`);
  const data = await response.json();
  return data.price;
}

// Fetch dashboard data
async function fetchDashboardData() {
  const response = await fetch(`${API_BASE}/dashboard`);
  const data = await response.json();
  return data;
}

// Fetch price history
async function fetchPriceHistory(days = 30) {
  const response = await fetch(`${API_BASE}/bitcoin/history?days=${days}`);
  const data = await response.json();
  return data.history;
}

// Fetch portfolio history
async function fetchPortfolioHistory(days = 30) {
  const response = await fetch(`${API_BASE}/dashboard/history?days=${days}`);
  const data = await response.json();
  return data.history;
}

// Update dashboard UI
async function updateDashboard() {
  try {
    refreshBtn.disabled = true;
    refreshBtn.textContent = 'Loading...';

    // Fetch all data
    const [dashboardData, priceHistory] = await Promise.all([
      fetchDashboardData(),
      fetchPriceHistory(30)
    ]);

    // Update stats
    btcPriceEl.textContent = `$${dashboardData.btcPrice.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;
    
    portfolioValueEl.textContent = `$${dashboardData.portfolioValue.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })}`;

    btcHeldEl.textContent = `${dashboardData.totalBtc.toFixed(8)} BTC`;

    const profitLossValue = dashboardData.profitLoss || 0;
    const profitLossPercent = dashboardData.totalCost > 0 
      ? ((profitLossValue / dashboardData.totalCost) * 100).toFixed(2)
      : 0;
    
    profitLossEl.textContent = `$${profitLossValue.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    })} (${profitLossPercent}%)`;
    
    profitLossEl.style.color = profitLossValue >= 0 ? '#10b981' : '#ef4444';

    // Update chart
    updateChart(priceHistory);

    // Update timestamp
    lastUpdateEl.textContent = new Date().toLocaleString();

    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh Data';
  } catch (error) {
    console.error('Error updating dashboard:', error);
    alert('Failed to update dashboard. Check console for details.');
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Refresh Data';
  }
}

// Update price chart
function updateChart(priceData) {
  const ctx = document.getElementById('price-chart').getContext('2d');

  // Prepare data for Chart.js
  const labels = priceData.map(([timestamp]) => {
    const date = new Date(timestamp);
    return date.toLocaleDateString();
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
        fill: true
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
              return '$' + context.parsed.y.toLocaleString('en-US', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2
              });
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
updateDashboard();