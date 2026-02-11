require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const { getBitcoinPrice, getBitcoinHistory } = require('./api/bitcoin');
const { 
  updateDashboard, 
  getDashboardData, 
  getPortfolioHistory 
} = require('./api/dashboard');
const { 
  getHoldings, 
  addHolding, 
  updateHolding, 
  deleteHolding 
} = require('./api/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'frontend')));

// Bitcoin API Routes
app.get('/api/bitcoin/price', async (req, res) => {
  try {
    const price = await getBitcoinPrice();
    res.json({ price });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/bitcoin/history', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 365;
    const history = await getBitcoinHistory(days);
    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Dashboard Routes
app.get('/api/dashboard', async (req, res) => {
  try {
    const data = await getDashboardData();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/dashboard/update', async (req, res) => {
  try {
    const data = await updateDashboard();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/dashboard/history', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30;
    const history = await getPortfolioHistory(days);
    res.json({ history });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Holdings CRUD Routes
app.get('/api/holdings', async (req, res) => {
  try {
    const holdings = await getHoldings();
    res.json({ holdings });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/holdings', async (req, res) => {
  try {
    const holding = await addHolding(req.body);
    res.json({ holding });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put('/api/holdings/:id', async (req, res) => {
  try {
    const holding = await updateHolding(req.params.id, req.body);
    res.json({ holding });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete('/api/holdings/:id', async (req, res) => {
  try {
    await deleteHolding(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'index.html'));
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard API ready`);
  console.log(`💾 Using Supabase database`);
});