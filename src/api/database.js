const supabase = require('./supabase');

// Get all holdings
async function getHoldings() {
  const { data, error } = await supabase
    .from('holdings')
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching holdings:', error);
    throw error;
  }

  return data;
}

// Get single holding by ID
async function getHoldingById(id) {
  const { data, error } = await supabase
    .from('holdings')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    console.error('Error fetching holding:', error);
    throw error;
  }

  return data;
}

// Add new holding
async function addHolding(holding) {
  const { data, error } = await supabase
    .from('holdings')
    .insert([holding])
    .select()
    .single();

  if (error) {
    console.error('Error adding holding:', error);
    throw error;
  }

  return data;
}

// Update holding
async function updateHolding(id, updates) {
  const { data, error } = await supabase
    .from('holdings')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating holding:', error);
    throw error;
  }

  return data;
}

// Delete holding
async function deleteHolding(id) {
  const { error } = await supabase
    .from('holdings')
    .delete()
    .eq('id', id);

  if (error) {
    console.error('Error deleting holding:', error);
    throw error;
  }

  return true;
}

// Save portfolio snapshot
async function savePortfolioSnapshot(snapshot) {
  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .insert([snapshot])
    .select()
    .single();

  if (error) {
    console.error('Error saving snapshot:', error);
    throw error;
  }

  return data;
}

// Get portfolio snapshots (last N days)
async function getPortfolioSnapshots(days = 30) {
  const date = new Date();
  date.setDate(date.getDate() - days);

  const { data, error } = await supabase
    .from('portfolio_snapshots')
    .select('*')
    .gte('created_at', date.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching snapshots:', error);
    throw error;
  }

  return data;
}

// Calculate portfolio value
async function calculatePortfolioValue(btcPrice) {
  const holdings = await getHoldings();
  
  let totalBtc = 0;
  let totalCost = 0;

  holdings.forEach(holding => {
    if (holding.asset.toLowerCase().includes('bitcoin') || holding.asset.toLowerCase().includes('btc')) {
      totalBtc += parseFloat(holding.amount);
      if (holding.purchase_price) {
        totalCost += parseFloat(holding.amount) * parseFloat(holding.purchase_price);
      }
    }
  });

  const portfolioValue = totalBtc * btcPrice;
  const profitLoss = portfolioValue - totalCost;

  return {
    totalBtc,
    portfolioValue,
    profitLoss,
    totalCost
  };
}

module.exports = {
  getHoldings,
  getHoldingById,
  addHolding,
  updateHolding,
  deleteHolding,
  savePortfolioSnapshot,
  getPortfolioSnapshots,
  calculatePortfolioValue
};