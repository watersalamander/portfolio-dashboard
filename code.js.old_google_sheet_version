// ============================================
// PORTFOLIO TRACKER - GOOGLE APPS SCRIPT
// ============================================

// ⚙️⚙️⚙️ CONFIGURATION - REQUIRED SETUP ⚙️⚙️⚙️
// ============================================
// 
// 📌 STEP 1: Find your Google Sheet ID
//    1. Open your Google Sheet with portfolio data
//    2. Look at the URL in your browser
//    3. The URL looks like: https://docs.google.com/spreadsheets/d/XXXXXXXXXXXXXXXXXXXXX/edit
//    4. Copy the long string (XXXXXXXXXXXXXXXXXXXXX) between "/d/" and "/edit"
//
// 📌 STEP 2: Paste your Sheet ID below (replace 'YOUR_SHEET_ID_HERE')
//
const SPREADSHEET_ID = '1QJpiMGuNvYTqOiV1muzCUTo7nvwZm-e5suF-Uu_X-Po';  // ⬅️⬅️⬅️ PASTE YOUR SHEET ID HERE
//
// Example: const SPREADSHEET_ID = '1a2B3c4D5e6F7g8H9i0JkLmNoPqRsTuVwXyZ';
//
// ============================================

// Yahoo Finance Configuration
const YAHOO_FINANCE_BASE_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const THB_TICKER = 'THB=X'; // USD to THB exchange rate

/**
 * Helper function to get your spreadsheet
 */
function getSpreadsheet() {
  if (SPREADSHEET_ID === 'YOUR_SHEET_ID_HERE') {
    throw new Error('❌ ERROR: Please set your SPREADSHEET_ID in Code.gs first!\n\nFind it in your spreadsheet URL between /d/ and /edit');
  }
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (e) {
    throw new Error('❌ ERROR: Cannot open spreadsheet. Please check your SPREADSHEET_ID is correct.\n\nError: ' + e.message);
  }
}

/**
 * Creates the menu when spreadsheet opens
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('📊 Portfolio Tracker')
    .addItem('Open Dashboard', 'openDashboard')
    .addSeparator()
    .addItem('Update Current Positions', 'updateCurrentPositions')
    .addItem('🔧 Rebuild Current Positions', 'rebuildCurrentPositions')
    .addItem('Save Portfolio Snapshot', 'savePortfolioSnapshot')
    .addSeparator()
    .addItem('⏰ Setup Daily Auto-Snapshot', 'setupDailySnapshot')
    .addItem('❌ Remove Auto-Snapshot', 'removeDailySnapshot')
    .addSeparator()
    .addItem('🔧 Run Diagnostics', 'runDiagnostics')
    .addToUi();
}

/**
 * Opens the dashboard in a modal dialog (when opened from menu)
 */
function openDashboard() {
  const html = HtmlService.createHtmlOutputFromFile('Dashboard')
    .setWidth(1400)
    .setHeight(900)
    .setTitle('Portfolio Dashboard');
  SpreadsheetApp.getUi().showModalDialog(html, 'Portfolio Dashboard');
}

/**
 * Serves the dashboard as a web app (when accessed via URL)
 * This is required for deploying as a web app
 */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Dashboard')
    .setTitle('Portfolio Dashboard')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Get live price from Yahoo Finance
 * Returns null for cash positions (CASH-*) or if price cannot be fetched
 */
function getYahooPrice(ticker) {
  try {
    // Skip Yahoo Finance API call for cash positions
    if (ticker.toString().toUpperCase().startsWith('CASH-')) {
      return null;
    }
    
    const url = YAHOO_FINANCE_BASE_URL + ticker;
    const response = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
    const json = JSON.parse(response.getContentText());
    
    if (json.chart && json.chart.result && json.chart.result[0]) {
      const result = json.chart.result[0];
      const price = result.meta.regularMarketPrice || result.meta.previousClose;
      return price;
    }
    
    // Log if ticker not found (helps with debugging)
    Logger.log('⚠️ No price data found for ticker: ' + ticker);
    return null;
  } catch (e) {
    Logger.log('❌ Error fetching price for ' + ticker + ': ' + e);
    return null;
  }
}

/**
 * Update Current_Positions from Transactions
 */
/**
 * Update current positions (called from menu)
 * Now uses the new double-entry logic with Initial_Positions + Transactions
 */
function updateCurrentPositions() {
  try {
    const result = updateCurrentPositionsQuiet();
    
    if (result) {
      SpreadsheetApp.getUi().alert('✅ Current positions updated successfully!\n\nCheck Current_Positions sheet for results.');
    } else {
      SpreadsheetApp.getUi().alert('⚠️ Update completed with issues.\n\nPlease check:\n1. Do you have data in Initial_Positions or Transactions?\n2. View > Execution log for details');
    }
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ Error: ' + e.message + '\n\nCheck View > Execution log for details');
    Logger.log('Error in updateCurrentPositions: ' + e.message);
    Logger.log('Stack: ' + e.stack);
  }
}

/**
 * DIAGNOSTIC: Check what data exists in your sheets
 * Run this from Apps Script editor to see what's in your sheets
 * 
 * HOW TO USE:
 * 1. Apps Script editor > Select "diagnosticCheckSheets" function
 * 2. Click Run
 * 3. Check View > Execution log
 */
function diagnosticCheckSheets() {
  const ss = getSpreadsheet();
  
  Logger.log('=== DIAGNOSTIC CHECK ===');
  Logger.log('Checking all sheets...\n');
  
  // Check Initial_Positions
  const initialPosSheet = ss.getSheetByName('Initial_Positions');
  if (initialPosSheet) {
    const data = initialPosSheet.getDataRange().getValues();
    Logger.log('✅ Initial_Positions found: ' + data.length + ' rows (including header)');
    
    if (data.length > 1) {
      Logger.log('   Headers: ' + JSON.stringify(data[0]));
      Logger.log('   First data row: ' + JSON.stringify(data[1]));
      Logger.log('   Sample: Ticker=' + data[1][1] + ', Action=' + data[1][4] + ', Qty=' + data[1][5]);
    } else {
      Logger.log('   ⚠️ Sheet is empty (only header row)');
    }
  } else {
    Logger.log('❌ Initial_Positions sheet NOT FOUND');
    Logger.log('   This is OK if you\'re using only Transactions sheet');
  }
  
  Logger.log('');
  
  // Check Transactions
  const transSheet = ss.getSheetByName('Transactions');
  if (transSheet) {
    const data = transSheet.getDataRange().getValues();
    Logger.log('✅ Transactions found: ' + data.length + ' rows (including header)');
    
    if (data.length > 1) {
      Logger.log('   Headers: ' + JSON.stringify(data[0]));
      Logger.log('   First data row: ' + JSON.stringify(data[1]));
      Logger.log('   Sample: Ticker=' + data[1][1] + ', Action=' + data[1][4] + ', Qty=' + data[1][5] + ', Currency=' + data[1][7]);
    } else {
      Logger.log('   ⚠️ Sheet is empty (only header row)');
    }
  } else {
    Logger.log('❌ Transactions sheet NOT FOUND');
    Logger.log('   This is OK if you\'re using only Initial_Positions sheet');
  }
  
  Logger.log('');
  
  // Check Current_Positions
  const posSheet = ss.getSheetByName('Current_Positions');
  if (posSheet) {
    const data = posSheet.getDataRange().getValues();
    Logger.log('✅ Current_Positions found: ' + data.length + ' rows');
    if (data.length > 1) {
      Logger.log('   Has data: YES');
    } else {
      Logger.log('   Has data: NO (empty or header only)');
    }
  } else {
    Logger.log('❌ Current_Positions sheet NOT FOUND');
    Logger.log('   You need to create this sheet!');
  }
  
  Logger.log('');
  Logger.log('=== END DIAGNOSTIC ===');
  Logger.log('\nRECOMMENDATION:');
  
  if (!initialPosSheet && !transSheet) {
    Logger.log('❌ You need at least one of: Initial_Positions OR Transactions sheet with data');
  } else if (!posSheet) {
    Logger.log('❌ Create a sheet named "Current_Positions"');
  } else if (initialPosSheet && initialPosSheet.getDataRange().getValues().length > 1) {
    Logger.log('✅ Initial_Positions has data - try running "Update Current Positions"');
  } else if (transSheet && transSheet.getDataRange().getValues().length > 1) {
    Logger.log('✅ Transactions has data - try running "Update Current Positions"');
  } else {
    Logger.log('⚠️ Your sheets exist but have no data - add some transactions first');
  }
}

/**
 * Get current exchange rate USD to THB
 */
function getExchangeRate() {
  const rate = getYahooPrice(THB_TICKER);
  return rate || 35.50; // Fallback to default
}

/**
 * Convert position cost from one currency to another
 * @param {Object} position - The position object to convert
 * @param {string} fromCurrency - Current currency (USD or THB)
 * @param {string} toCurrency - Target currency (USD or THB)
 */
function convertPositionCurrency(position, fromCurrency, toCurrency) {
  // Skip if same currency or no conversion needed
  if (fromCurrency === toCurrency) {
    return;
  }
  
  const exchangeRate = getExchangeRate();
  
  Logger.log('💱 Converting position currency: ' + fromCurrency + ' → ' + toCurrency);
  Logger.log('   Exchange rate: ' + exchangeRate);
  Logger.log('   Before: longCost=' + position.longCost + ', shortCost=' + position.shortCost);
  
  if (fromCurrency === 'THB' && toCurrency === 'USD') {
    // Convert THB to USD: divide by exchange rate
    position.longCost = position.longCost / exchangeRate;
    position.shortCost = position.shortCost / exchangeRate;
    position.longFees = position.longFees / exchangeRate;
    position.shortFees = position.shortFees / exchangeRate;
  } else if (fromCurrency === 'USD' && toCurrency === 'THB') {
    // Convert USD to THB: multiply by exchange rate
    position.longCost = position.longCost * exchangeRate;
    position.shortCost = position.shortCost * exchangeRate;
    position.longFees = position.longFees * exchangeRate;
    position.shortFees = position.shortFees * exchangeRate;
  }
  
  Logger.log('   After: longCost=' + position.longCost + ', shortCost=' + position.shortCost);
  Logger.log('   ✅ Conversion complete');
}

/**
 * Get portfolio data for dashboard
 */
function getPortfolioData() {
  const ss = getSpreadsheet();
  
  // Update positions first
  updateCurrentPositionsQuiet();
  
  const posSheet = ss.getSheetByName('Current_Positions');
  const configSheet = ss.getSheetByName('Config');
  
  if (!posSheet) {
    throw new Error('❌ "Current_Positions" sheet not found!');
  }
  
  // Get exchange rate
  const exchangeRate = getExchangeRate();
  
  // Update config if sheet exists
  if (configSheet) {
    configSheet.getRange('B2').setValue(exchangeRate);
    configSheet.getRange('B3').setValue(new Date());
  }
  
  // Get positions
  const posData = posSheet.getDataRange().getValues();
  if (posData.length < 2) {
    return {
      positions: [],
      totalValueUSD: 0,
      totalCostUSD: 0,
      totalGainLossUSD: 0,
      totalGainLossPct: 0,
      assetAllocation: {},
      exchangeRate: exchangeRate,
      lastUpdate: new Date().toISOString()
    };
  }
  
  const positions = posData.slice(1); // Skip header
  
  const portfolioPositions = [];
  let totalValueUSD = 0;
  let totalCostUSD = 0;
  const assetAllocation = {};
  
  positions.forEach(row => {
    if (!row[0]) return;
    
    const ticker = row[0];
    const assetName = row[1];
    const assetType = row[2];
    const posType = row[3];
    const quantity = parseFloat(row[4]) || 0;
    const avgCost = parseFloat(row[5]) || 0;
    const totalCost = parseFloat(row[6]) || 0;
    const currency = row[7] || 'USD';
    
    // Check if this is a cash position (ticker starts with "CASH-")
    const isCashPosition = ticker.toString().toUpperCase().startsWith('CASH-');
    
    // Get live price - skip Yahoo Finance for cash positions
    let livePrice;
    if (isCashPosition) {
      // For cash positions, use avgCost if available, otherwise default to 1.00
      livePrice = avgCost > 0 ? avgCost : 1.00;
    } else {
      livePrice = getYahooPrice(ticker);
    }
    
    // For cash positions, always process even if livePrice is 0
    // For other assets, only process if we got a valid price
    if (livePrice || isCashPosition) {
      // Use 1.00 as default price for cash if somehow still 0
      const effectivePrice = isCashPosition && !livePrice ? 1.00 : livePrice;
      
      let currentValue, gainLoss, gainLossPct;
      
      if (posType === 'LONG') {
        currentValue = quantity * effectivePrice;
        gainLoss = currentValue - totalCost;
        gainLossPct = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
      } else { // SHORT
        // For shorts: profit when price goes down
        currentValue = totalCost - (quantity * effectivePrice - totalCost);
        gainLoss = (avgCost - effectivePrice) * quantity;
        gainLossPct = totalCost > 0 ? (gainLoss / totalCost) * 100 : 0;
      }
      
      // Convert to USD if needed
      let valueUSD = currentValue;
      let costUSD = totalCost;
      if (currency === 'THB') {
        valueUSD = currentValue / exchangeRate;
        costUSD = totalCost / exchangeRate;
      }
      
      totalValueUSD += valueUSD;
      totalCostUSD += costUSD;
      
      // Asset allocation
      if (!assetAllocation[assetType]) {
        assetAllocation[assetType] = 0;
      }
      assetAllocation[assetType] += valueUSD;
      
      portfolioPositions.push({
        ticker: ticker,
        assetName: assetName,
        assetType: assetType,
        positionType: posType,
        quantity: quantity,
        avgCost: avgCost > 0 ? avgCost : effectivePrice,
        currentPrice: effectivePrice,
        currentValue: currentValue,
        costBasis: totalCost,
        gainLoss: gainLoss,
        gainLossPct: gainLossPct,
        currency: currency,
        isCash: isCashPosition
      });
    }
  });
  
  return {
    positions: portfolioPositions,
    totalValueUSD: totalValueUSD,
    totalCostUSD: totalCostUSD,
    totalGainLossUSD: totalValueUSD - totalCostUSD,
    totalGainLossPct: totalCostUSD > 0 ? ((totalValueUSD - totalCostUSD) / totalCostUSD) * 100 : 0,
    assetAllocation: assetAllocation,
    exchangeRate: exchangeRate,
    lastUpdate: new Date().toISOString()
  };
}

/**
 * Silent version of updateCurrentPositions (no UI alerts)
 * Returns true if successful, false if error
 */
function updateCurrentPositionsQuiet() {
  try {
    const ss = getSpreadsheet();
    const initialPosSheet = ss.getSheetByName('Initial_Positions');
    const transSheet = ss.getSheetByName('Transactions');
    const posSheet = ss.getSheetByName('Current_Positions');
    
    Logger.log('=== UPDATE CURRENT POSITIONS DEBUG ===');
    Logger.log('Initial_Positions sheet exists: ' + (initialPosSheet ? 'YES' : 'NO'));
    Logger.log('Transactions sheet exists: ' + (transSheet ? 'YES' : 'NO'));
    Logger.log('Current_Positions sheet exists: ' + (posSheet ? 'YES' : 'NO'));
    
    if (!posSheet) {
      Logger.log('❌ Current_Positions sheet not found');
      return false;
    }
    
    // Track positions by ticker
    const positions = {};
    
    // Helper function to create composite key for grouping
    function getPositionKey(ticker, assetName, assetType) {
      // Combine ticker, asset name, and asset type to create unique key
      // This allows same ticker with different names/types (e.g., CASH-THB for both cash and MMF)
      return ticker + '|' + assetName + '|' + assetType;
    }
    
    // Helper function to get or create position
    function getPosition(ticker, assetName, assetType) {
      const key = getPositionKey(ticker, assetName, assetType);
      
      if (!positions[key]) {
        positions[key] = {
          ticker: ticker,
          assetName: assetName,
          assetType: assetType,
          longQty: 0,
          shortQty: 0,
          longCost: 0,
          shortCost: 0,
          longFees: 0,
          shortFees: 0,
          currency: 'USD'
        };
        Logger.log('Created new position for: ' + ticker + ' (' + assetName + ', ' + assetType + ')');
      }
      return positions[key];
    }
    
    // STEP 1: Process Initial_Positions (OLD FORMAT: Currency = THB or USD)
    if (initialPosSheet) {
      const initialData = initialPosSheet.getDataRange().getValues();
      Logger.log('Initial_Positions rows (including header): ' + initialData.length);
      
      if (initialData.length > 1) {
        const initialTransactions = initialData.slice(1);
        Logger.log('📊 Processing ' + initialTransactions.length + ' initial positions...');
        
        initialTransactions.forEach((row, index) => {
          if (!row[1]) {
            Logger.log('Skipping empty row ' + (index + 2));
            return;
          }
          
          try {
            const ticker = row[1].toString().trim();
            const assetName = row[2];
            const assetType = row[3];
            const action = row[4].toString().toUpperCase();
            const quantity = parseFloat(row[5]) || 0;
            const price = parseFloat(row[6]) || 0;
            const currency = row[7] || 'USD';
            const fees = parseFloat(row[8]) || 0;
            
            Logger.log('Processing Initial_Positions row ' + (index + 2) + ': ' + ticker + ' ' + action + ' ' + quantity);
            
            const pos = getPosition(ticker, assetName, assetType);
            
            // CRITICAL FIX: Convert existing cost before changing currency
            if (pos.currency && pos.currency !== currency) {
              Logger.log('⚠️ Position ' + ticker + ' currency mismatch in Initial_Positions!');
              Logger.log('   Current: ' + pos.currency + ', Row requires: ' + currency);
              convertPositionCurrency(pos, pos.currency, currency);
            }
            pos.currency = currency;
            
            const totalCost = quantity * price;
            
            switch(action) {
              case 'BUY':
                pos.longCost += totalCost;
                pos.longQty += quantity;
                pos.longFees += fees;
                break;
              case 'SELL':
                if (pos.longQty > 0) {
                  const avgCost = pos.longCost / pos.longQty;
                  pos.longCost -= quantity * avgCost;
                  pos.longQty -= quantity;
                  pos.longFees += fees;
                }
                break;
              case 'DEPOSIT':
                // Add funds from external source
                pos.longQty += quantity;
                pos.longCost += totalCost;
                pos.longFees += fees;
                break;
              case 'WITHDRAWAL':
                // Remove funds to external destination
                if (pos.longQty >= quantity) {
                  const avgCost = pos.longCost / pos.longQty;
                  pos.longCost -= quantity * avgCost;
                  pos.longQty -= quantity;
                  pos.longFees += fees;
                }
                break;
              case 'SHORT':
                pos.shortCost += totalCost;
                pos.shortQty += quantity;
                pos.shortFees += fees;
                break;
              case 'COVER':
                if (pos.shortQty > 0) {
                  const avgCost = pos.shortCost / pos.shortQty;
                  pos.shortCost -= quantity * avgCost;
                  pos.shortQty -= quantity;
                  pos.shortFees += fees;
                }
                break;
              default:
                Logger.log('⚠️ Unknown action "' + action + '" in Initial_Positions row ' + (index + 2));
            }
          } catch (e) {
            Logger.log('⚠️ Error processing Initial_Positions row ' + (index + 2) + ': ' + e.message);
          }
        });
      }
    } else {
      Logger.log('ℹ️ No Initial_Positions sheet found');
    }
    
    // STEP 2: Process Transactions (NEW FORMAT: Currency = ticker like USDT-USD)
    if (transSheet) {
      const transData = transSheet.getDataRange().getValues();
      if (transData.length > 1) {
        const transactions = transData.slice(1);
        Logger.log('📊 Processing ' + transactions.length + ' new transactions...');
        
        transactions.forEach((row, index) => {
          if (!row[1]) return;
          
          try {
            const ticker = row[1].toString().trim();
            const assetName = row[2];
            const assetType = row[3];
            const action = row[4].toString().toUpperCase();
            const quantity = parseFloat(row[5]) || 0;
            const price = parseFloat(row[6]) || 0;
            const paymentTicker = row[7] ? row[7].toString().trim() : '';
            const fees = parseFloat(row[8]) || 0;
            
            // Total payment = quantity × price
            const totalPayment = quantity * price;
            
            // Get the asset position
            const assetPos = getPosition(ticker, assetName, assetType);
            
            // For DEPOSIT and WITHDRAWAL, no payment asset involved
            if (action === 'DEPOSIT' || action === 'WITHDRAWAL') {
              // Determine currency for single-entry transactions
              let entryCurrency = 'USD';
              if (ticker.toUpperCase().includes('THB')) {
                entryCurrency = 'THB';
              }
              
              // CRITICAL FIX: Convert existing cost before changing currency
              if (assetPos.currency && assetPos.currency !== entryCurrency) {
                Logger.log('⚠️ Position ' + ticker + ' currency mismatch in DEPOSIT/WITHDRAWAL!');
                Logger.log('   Current: ' + assetPos.currency + ', Transaction requires: ' + entryCurrency);
                convertPositionCurrency(assetPos, assetPos.currency, entryCurrency);
              }
              assetPos.currency = entryCurrency;
              
              // Process single-entry action
              if (action === 'DEPOSIT') {
                assetPos.longQty += quantity;
                assetPos.longCost += quantity * price;
                assetPos.longFees += fees;
                Logger.log('💰 DEPOSIT: +' + quantity + ' ' + ticker);
              } else { // WITHDRAWAL
                if (assetPos.longQty >= quantity) {
                  const avgCost = assetPos.longQty > 0 ? assetPos.longCost / assetPos.longQty : price;
                  assetPos.longCost -= quantity * avgCost;
                  assetPos.longQty -= quantity;
                  assetPos.longFees += fees;
                  Logger.log('💸 WITHDRAWAL: -' + quantity + ' ' + ticker);
                }
              }
              
              return; // Skip payment processing
            }
            
            // Parse payment ticker to determine asset details (for double-entry actions)
            let paymentAssetName = paymentTicker;
            let paymentAssetType = 'Cash';
            let paymentCurrency = 'USD';
            
            if (paymentTicker.toUpperCase().includes('USDT')) {
              paymentAssetName = 'USDT';
              paymentAssetType = 'Stablecoin';
              paymentCurrency = 'USD';
            } else if (paymentTicker.toUpperCase().includes('USDC')) {
              paymentAssetName = 'USDC';
              paymentAssetType = 'Stablecoin';
              paymentCurrency = 'USD';
            } else if (paymentTicker.toUpperCase().includes('DAI')) {
              paymentAssetName = 'DAI';
              paymentAssetType = 'Stablecoin';
              paymentCurrency = 'USD';
            } else if (paymentTicker.toUpperCase().includes('THB')) {
              paymentAssetName = 'Cash (THB)';
              paymentAssetType = 'Cash';
              paymentCurrency = 'THB';
            } else if (paymentTicker.toUpperCase().includes('USD') && paymentTicker.toUpperCase().includes('CASH')) {
              paymentAssetName = 'Cash (USD)';
              paymentAssetType = 'Cash';
              paymentCurrency = 'USD';
            }
            
            // Get or create payment asset position
            const paymentPos = getPosition(paymentTicker, paymentAssetName, paymentAssetType);
            
            // CRITICAL FIX: Convert existing cost before changing currency
            // This prevents cost in THB from being mislabeled as USD (or vice versa)
            if (paymentPos.currency && paymentPos.currency !== paymentCurrency) {
              Logger.log('⚠️ Payment asset ' + paymentTicker + ' currency mismatch!');
              Logger.log('   Current: ' + paymentPos.currency + ', Transaction requires: ' + paymentCurrency);
              convertPositionCurrency(paymentPos, paymentPos.currency, paymentCurrency);
            }
            paymentPos.currency = paymentCurrency;
            
            // Convert asset position currency if needed
            if (assetPos.currency && assetPos.currency !== paymentCurrency) {
              Logger.log('⚠️ Asset ' + ticker + ' currency mismatch!');
              Logger.log('   Current: ' + assetPos.currency + ', Transaction requires: ' + paymentCurrency);
              convertPositionCurrency(assetPos, assetPos.currency, paymentCurrency);
            }
            assetPos.currency = paymentCurrency;
            
            // DOUBLE-ENTRY LOGIC: Each transaction affects TWO positions
            switch(action) {
              case 'BUY':
                // Acquire asset (increase)
                assetPos.longCost += totalPayment;
                assetPos.longQty += quantity;
                assetPos.longFees += fees;
                
                // Spend payment asset (decrease)
                if (paymentPos.longQty >= totalPayment) {
                  // Have enough, reduce proportionally
                  const avgCostPerUnit = paymentPos.longCost / paymentPos.longQty;
                  paymentPos.longCost -= totalPayment * avgCostPerUnit;
                  paymentPos.longQty -= totalPayment;
                } else {
                  // Don't have enough, go negative (borrowed/debt)
                  paymentPos.longQty -= totalPayment;
                  paymentPos.longCost = paymentPos.longQty; // 1:1 for stablecoins/cash
                }
                break;
                
              case 'SELL':
                // Reduce asset (decrease)
                if (assetPos.longQty >= quantity) {
                  const avgCost = assetPos.longCost / assetPos.longQty;
                  assetPos.longCost -= quantity * avgCost;
                  assetPos.longQty -= quantity;
                  assetPos.longFees += fees;
                }
                
                // Receive payment asset (increase)
                paymentPos.longQty += totalPayment;
                paymentPos.longCost += totalPayment;
                break;
                
              case 'SHORT':
                // Short asset (increase short position)
                assetPos.shortCost += totalPayment;
                assetPos.shortQty += quantity;
                assetPos.shortFees += fees;
                
                // Spend payment as collateral (decrease)
                if (paymentPos.longQty >= totalPayment) {
                  const avgCostPerUnit = paymentPos.longCost / paymentPos.longQty;
                  paymentPos.longCost -= totalPayment * avgCostPerUnit;
                  paymentPos.longQty -= totalPayment;
                } else {
                  paymentPos.longQty -= totalPayment;
                  paymentPos.longCost = paymentPos.longQty;
                }
                break;
                
              case 'COVER':
                // Cover short (decrease short position)
                if (assetPos.shortQty >= quantity) {
                  const avgCostPerUnit = assetPos.shortCost / assetPos.shortQty;
                  assetPos.shortCost -= quantity * avgCostPerUnit;
                  assetPos.shortQty -= quantity;
                  assetPos.shortFees += fees;
                }
                
                // Spend payment to cover (decrease)
                if (paymentPos.longQty >= totalPayment) {
                  const avgCostPerUnit = paymentPos.longCost / paymentPos.longQty;
                  paymentPos.longCost -= totalPayment * avgCostPerUnit;
                  paymentPos.longQty -= totalPayment;
                } else {
                  paymentPos.longQty -= totalPayment;
                  paymentPos.longCost = paymentPos.longQty;
                }
                break;
                
              default:
                Logger.log('⚠️ Unknown action "' + action + '" in Transactions row ' + (index + 2));
            }
          } catch (e) {
            Logger.log('⚠️ Error processing Transactions row ' + (index + 2) + ': ' + e.message);
          }
        });
      }
    } else {
      Logger.log('ℹ️ No Transactions sheet found');
    }
    
    // STEP 3: Write to Current_Positions
    Logger.log('=== WRITING TO CURRENT_POSITIONS ===');
    Logger.log('Total unique tickers in positions object: ' + Object.keys(positions).length);
    
    posSheet.clearContents();
    posSheet.getRange('A1:H1').setValues([[
      'Ticker', 'Asset Name', 'Asset Type', 'Position Type', 
      'Quantity', 'Avg Cost', 'Total Cost Basis', 'Currency'
    ]]).setFontWeight('bold').setBackground('#34a853').setFontColor('#ffffff');
    
    const posData = [];
    for (const ticker in positions) {
      const pos = positions[ticker];
      
      Logger.log('Checking ' + ticker + ': longQty=' + pos.longQty + ', shortQty=' + pos.shortQty);
      
      // Only show positions with non-zero quantity
      if (Math.abs(pos.longQty) > 0.0001) {
        const avgCost = pos.longQty !== 0 ? Math.abs(pos.longCost / pos.longQty) : 0;
        const totalCost = pos.longCost + pos.longFees;
        posData.push([
          pos.ticker, pos.assetName, pos.assetType, 'LONG',
          pos.longQty, avgCost, totalCost, pos.currency
        ]);
        Logger.log('✅ Adding LONG position: ' + ticker + ' qty=' + pos.longQty);
      }
      
      if (pos.shortQty > 0.0001) {
        const avgCost = pos.shortCost / pos.shortQty;
        const totalCost = pos.shortCost + pos.shortFees;
        posData.push([
          pos.ticker, pos.assetName, pos.assetType, 'SHORT',
          pos.shortQty, avgCost, totalCost, pos.currency
        ]);
        Logger.log('✅ Adding SHORT position: ' + ticker + ' qty=' + pos.shortQty);
      }
    }
    
    Logger.log('Total positions to write: ' + posData.length);
    
    if (posData.length > 0) {
      posSheet.getRange(2, 1, posData.length, 8).setValues(posData);
      Logger.log('✅ Updated ' + posData.length + ' positions');
    } else {
      Logger.log('⚠️ No positions calculated - check if Initial_Positions or Transactions has data');
    }
    
    return true;
    
  } catch (e) {
    Logger.log('❌ Error in updateCurrentPositionsQuiet: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    return false;
  }
}

/**
 * Save current portfolio snapshot to history
 * This version works with time-based triggers (no UI access)
 */
function savePortfolioSnapshot() {
  try {
    const data = getPortfolioData();
    if (!data || data.positions.length === 0) {
      Logger.log('⚠️ No portfolio data to save!');
      return;
    }
    
    const exchangeRate = data.exchangeRate;
    
    // Calculate values using same logic as dashboard cards
    let totalValueUSD = 0;
    let totalGainLossUSD = 0;
    
    data.positions.forEach(pos => {
      const posCurrency = pos.currency;
      
      // Determine the asset's native currency (what currency the price is in from Yahoo)
      let priceNativeCurrency = 'USD';
      if (pos.ticker.endsWith('.BK')) {
        priceNativeCurrency = 'THB';
      } else if (pos.ticker.startsWith('CASH-THB')) {
        priceNativeCurrency = 'THB';
      } else if (pos.ticker.startsWith('CASH-USD')) {
        priceNativeCurrency = 'USD';
      }
      
      // Convert avg cost to USD
      let avgCostUSD = pos.avgCost;
      if (posCurrency === 'THB') {
        avgCostUSD = pos.avgCost / exchangeRate;
      }
      
      // Convert current price to USD
      let currentPriceUSD = pos.currentPrice;
      if (priceNativeCurrency === 'THB') {
        currentPriceUSD = pos.currentPrice / exchangeRate;
      }
      
      // Calculate values in USD
      const currentValueUSD = currentPriceUSD * pos.quantity;
      const gainLossUSD = (currentPriceUSD - avgCostUSD) * pos.quantity;
      
      totalValueUSD += currentValueUSD;
      totalGainLossUSD += gainLossUSD;
    });
    
    // Convert to THB for the THB column
    const totalValueTHB = totalValueUSD * exchangeRate;
    
    const ss = getSpreadsheet();
    let histSheet = ss.getSheetByName('Portfolio_History');
    
    // Create Portfolio_History sheet if it doesn't exist
    if (!histSheet) {
      histSheet = ss.insertSheet('Portfolio_History');
      histSheet.getRange('A1:E1').setValues([[
        'Timestamp', 'Total Value (USD)', 'Total Value (THB)', 
        'Exchange Rate', 'Total Gain/Loss (USD)'
      ]]).setFontWeight('bold').setBackground('#fbbc04').setFontColor('#ffffff');
      Logger.log('✅ Created Portfolio_History sheet');
    }
    
    histSheet.appendRow([
      new Date(),
      totalValueUSD,
      totalValueTHB,
      exchangeRate,
      totalGainLossUSD
    ]);
    
    Logger.log('✅ Portfolio snapshot saved!');
    Logger.log('Total Value (USD): $' + totalValueUSD.toFixed(2));
    Logger.log('Total Value (THB): ฿' + totalValueTHB.toFixed(2));
    Logger.log('Total Gain/Loss (USD): $' + totalGainLossUSD.toFixed(2));
    
    // Only show UI alert if we have UI access (not from trigger)
    try {
      SpreadsheetApp.getUi().alert(
        '✅ Portfolio snapshot saved!\n\n' +
        'Total Value: $' + totalValueUSD.toFixed(2) + ' (฿' + totalValueTHB.toFixed(2) + ')\n' +
        'Total Return: $' + totalGainLossUSD.toFixed(2)
      );
    } catch (e) {
      // No UI access (running from trigger) - that's fine, just log
      Logger.log('Snapshot saved from automated trigger');
    }
    
  } catch (e) {
    Logger.log('❌ Error saving snapshot: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    
    // Try to show error in UI if available
    try {
      SpreadsheetApp.getUi().alert('Error saving snapshot: ' + e.message);
    } catch (uiError) {
      // No UI access - just log
    }
  }
}

/**
 * Get portfolio history for chart
 */
function getPortfolioHistory() {
  try {
    Logger.log('=== getPortfolioHistory() called ===');
    
    const ss = getSpreadsheet();
    Logger.log('✅ Got spreadsheet: ' + ss.getName());
    
    const histSheet = ss.getSheetByName('Portfolio_History');
    
    if (!histSheet) {
      Logger.log('⚠️ Portfolio_History sheet not found');
      Logger.log('Available sheets: ' + ss.getSheets().map(s => s.getName()).join(', '));
      return [];
    }
    
    Logger.log('✅ Found Portfolio_History sheet');
    
    const data = histSheet.getDataRange().getValues();
    Logger.log('📊 Retrieved ' + data.length + ' rows (including header)');
    
    if (data.length < 2) {
      Logger.log('⚠️ No history data found (only header or empty)');
      return [];
    }
    
    const history = data.slice(1); // Skip header
    Logger.log('✅ Processing ' + history.length + ' data rows');
    
    // CRITICAL FIX: Convert Date objects to ISO strings for serialization
    const result = history.map(function(row) {
      // Convert timestamp to ISO string (or keep as-is if already string)
      var timestamp = row[0];
      if (timestamp instanceof Date) {
        timestamp = timestamp.toISOString();
      } else if (typeof timestamp === 'string') {
        // Already a string, keep it
        timestamp = timestamp;
      } else {
        // Try to convert to date then to string
        timestamp = new Date(timestamp).toISOString();
      }
      
      return {
        timestamp: timestamp,  // Now a string, not a Date object
        valueUSD: Number(row[1]),
        valueTHB: Number(row[2]),
        exchangeRate: Number(row[3]),
        gainLossUSD: Number(row[4])
      };
    });
    
    Logger.log('✅ Mapped ' + result.length + ' records');
    Logger.log('First record timestamp type: ' + typeof result[0].timestamp);
    Logger.log('First record: ' + JSON.stringify(result[0]));
    Logger.log('Last record: ' + JSON.stringify(result[result.length - 1]));
    Logger.log('Returning result array with length: ' + result.length);
    
    return result;
    
  } catch (e) {
    Logger.log('❌ Error loading portfolio history: ' + e.message);
    Logger.log('❌ Error stack: ' + e.stack);
    return [];
  }
}

// ============================================
// 🔧 DEBUGGING FUNCTIONS
// ============================================

/**
 * Test function to check if sheet connection is working
 * Run this from Apps Script editor to diagnose issues
 */
function testSheetConnection() {
  Logger.clear();
  
  try {
    Logger.log('=== TESTING SHEET CONNECTION ===');
    Logger.log('');
    
    // Test 1: Check Sheet ID
    Logger.log('📌 Step 1: Checking Sheet ID...');
    if (SPREADSHEET_ID === 'YOUR_SHEET_ID_HERE') {
      Logger.log('❌ ERROR: SPREADSHEET_ID not set!');
      Logger.log('   Please update line 16 in Code.gs with your Sheet ID');
      return;
    }
    Logger.log('✅ Sheet ID is set: ' + SPREADSHEET_ID);
    Logger.log('');
    
    // Test 2: Try to open spreadsheet
    Logger.log('📌 Step 2: Opening spreadsheet...');
    const ss = getSpreadsheet();
    Logger.log('✅ Successfully opened: ' + ss.getName());
    Logger.log('');
    
    // Test 3: Check for required sheets
    Logger.log('📌 Step 3: Checking for required sheets...');
    const sheetNames = ss.getSheets().map(s => s.getName());
    Logger.log('   Found sheets: ' + sheetNames.join(', '));
    Logger.log('');
    
    // Check Transactions
    const transSheet = ss.getSheetByName('Transactions');
    if (!transSheet) {
      Logger.log('❌ ERROR: "Transactions" sheet not found!');
      Logger.log('   Please create a sheet named exactly "Transactions"');
    } else {
      Logger.log('✅ "Transactions" sheet found');
      const transData = transSheet.getDataRange().getValues();
      Logger.log('   Rows in Transactions: ' + transData.length);
      if (transData.length > 0) {
        Logger.log('   Headers: ' + transData[0].join(', '));
        Logger.log('   Data rows: ' + (transData.length - 1));
      }
    }
    Logger.log('');
    
    // Check Current_Positions
    const posSheet = ss.getSheetByName('Current_Positions');
    if (!posSheet) {
      Logger.log('❌ ERROR: "Current_Positions" sheet not found!');
      Logger.log('   Please create a sheet named exactly "Current_Positions"');
    } else {
      Logger.log('✅ "Current_Positions" sheet found');
      const posData = posSheet.getDataRange().getValues();
      Logger.log('   Rows in Current_Positions: ' + posData.length);
      if (posData.length > 0) {
        Logger.log('   Headers: ' + posData[0].join(', '));
        Logger.log('   Data rows: ' + (posData.length - 1));
      }
    }
    Logger.log('');
    
    // Test 4: Try to get portfolio data
    Logger.log('📌 Step 4: Testing portfolio data fetch...');
    try {
      const data = getPortfolioData();
      Logger.log('✅ Portfolio data retrieved successfully!');
      Logger.log('   Total positions: ' + data.positions.length);
      Logger.log('   Total value (USD): $' + data.totalValueUSD.toFixed(2));
      Logger.log('   Exchange rate: ' + data.exchangeRate);
      
      if (data.positions.length > 0) {
        Logger.log('');
        Logger.log('   Sample positions:');
        data.positions.slice(0, 3).forEach(pos => {
          Logger.log('   - ' + pos.ticker + ': ' + pos.quantity + ' @ $' + pos.currentPrice);
        });
      } else {
        Logger.log('⚠️ WARNING: No positions found!');
        Logger.log('   This means either:');
        Logger.log('   1. Transactions sheet is empty');
        Logger.log('   2. Current_Positions sheet is empty');
        Logger.log('   3. Data format is incorrect');
      }
    } catch (e) {
      Logger.log('❌ ERROR getting portfolio data: ' + e.message);
      Logger.log('   Stack: ' + e.stack);
    }
    
    Logger.log('');
    Logger.log('=== TEST COMPLETE ===');
    Logger.log('Check the logs above for any ❌ errors');
    
  } catch (e) {
    Logger.log('❌ CRITICAL ERROR: ' + e.message);
    Logger.log('   Stack: ' + e.stack);
  }
}

/**
 * Show test results in a dialog box
 */
function runDiagnostics() {
  try {
    testSheetConnection();
    
    // Get logs
    const logs = Logger.getLog();
    
    // Show in dialog
    const html = HtmlService.createHtmlOutput(
      '<pre style="font-family: monospace; font-size: 12px; white-space: pre-wrap;">' + 
      logs + 
      '</pre>'
    )
    .setWidth(800)
    .setHeight(600)
    .setTitle('Diagnostics Results');
    
    SpreadsheetApp.getUi().showModalDialog(html, 'Portfolio Tracker Diagnostics');
    
  } catch (e) {
    SpreadsheetApp.getUi().alert('Error running diagnostics: ' + e.message);
  }
}

/**
 * Force rebuild Current_Positions from scratch
 * Use this if you suspect data corruption in Current_Positions
 */
function rebuildCurrentPositions() {
  const ui = SpreadsheetApp.getUi();
  
  const response = ui.alert(
    '🔧 Rebuild Current Positions',
    'This will completely clear and recalculate Current_Positions from scratch.\n\n' +
    'Use this if you see weird numbers like:\n' +
    '- Wrong average costs (e.g., USDT showing ฿1,087 instead of ฿31)\n' +
    '- Incorrect gain/loss calculations\n' +
    '- Corrupted position values\n\n' +
    'This will NOT modify your Initial_Positions or Transactions data.\n\n' +
    'Continue?',
    ui.ButtonSet.YES_NO
  );
  
  if (response !== ui.Button.YES) {
    return;
  }
  
  try {
    const ss = getSpreadsheet();
    const posSheet = ss.getSheetByName('Current_Positions');
    
    if (!posSheet) {
      ui.alert('❌ Current_Positions sheet not found! Please create it first.');
      return;
    }
    
    // Clear everything
    posSheet.clear();
    
    Logger.log('🧹 Cleared Current_Positions sheet');
    
    // Add header back
    posSheet.getRange('A1:H1').setValues([[
      'Ticker', 'Asset Name', 'Asset Type', 'Position Type', 
      'Quantity', 'Avg Cost', 'Total Cost Basis', 'Currency'
    ]]).setFontWeight('bold').setBackground('#34a853').setFontColor('#ffffff');
    
    Logger.log('✅ Added headers');
    
    // Recalculate from scratch
    const success = updateCurrentPositionsQuiet();
    
    if (success) {
      ui.alert(
        '✅ Rebuild Complete!',
        'Current_Positions has been rebuilt from scratch.\n\n' +
        'Please check:\n' +
        '1. USDT avg cost should be around ฿31 (not ฿1,087)\n' +
        '2. All positions show reasonable numbers\n' +
        '3. Gain/loss calculations look correct\n\n' +
        'Refresh your dashboard to see the updated values.',
        ui.ButtonSet.OK
      );
    } else {
      ui.alert(
        '⚠️ Rebuild completed with warnings',
        'Check View > Execution log for details.\n' +
        'You may need to verify your Initial_Positions and Transactions data.',
        ui.ButtonSet.OK
      );
    }
    
  } catch (e) {
    Logger.log('❌ Error in rebuildCurrentPositions: ' + e.message);
    Logger.log('Stack: ' + e.stack);
    ui.alert('❌ Error: ' + e.message + '\n\nCheck View > Execution log for details.');
  }
}

// ============================================
// 📅 AUTOMATED DAILY SNAPSHOTS
// ============================================

/**
 * Setup automated daily portfolio snapshot
 */
function setupDailySnapshot() {
  try {
    const ui = SpreadsheetApp.getUi();
    
    // Check if trigger already exists
    const triggers = ScriptApp.getProjectTriggers();
    const existingTrigger = triggers.find(t => 
      t.getHandlerFunction() === 'savePortfolioSnapshot' && 
      t.getEventType() === ScriptApp.EventType.CLOCK
    );
    
    if (existingTrigger) {
      const response = ui.alert(
        'Auto-Snapshot Already Active',
        'Daily snapshots are already scheduled. Do you want to update the time?',
        ui.ButtonSet.YES_NO
      );
      
      if (response === ui.Button.NO) {
        return;
      }
      
      // Delete existing trigger
      ScriptApp.deleteTrigger(existingTrigger);
    }
    
    // Ask user for preferred time
    const response = ui.prompt(
      'Setup Daily Auto-Snapshot',
      'What time should snapshots be saved daily? (0-23 hours in 24-hour format)\n' +
      'Examples:\n' +
      '- 18 = 6:00 PM\n' +
      '- 9 = 9:00 AM\n' +
      '- 0 = Midnight\n\n' +
      'Recommended: 18 (6 PM after market close)',
      ui.ButtonSet.OK_CANCEL
    );
    
    if (response.getSelectedButton() !== ui.Button.OK) {
      return;
    }
    
    const hourInput = response.getResponseText().trim();
    const hour = parseInt(hourInput);
    
    if (isNaN(hour) || hour < 0 || hour > 23) {
      ui.alert('Invalid hour. Please enter a number between 0 and 23.');
      return;
    }
    
    // Create daily trigger
    ScriptApp.newTrigger('savePortfolioSnapshot')
      .timeBased()
      .atHour(hour)
      .everyDays(1)
      .create();
    
    ui.alert(
      '✅ Auto-Snapshot Activated!',
      `Portfolio snapshots will be saved daily at ${formatHour(hour)}.\n\n` +
      'Your Portfolio_History sheet will automatically populate each day.\n\n' +
      'To stop auto-snapshots, use: 📊 Portfolio Tracker > ❌ Remove Auto-Snapshot',
      ui.ButtonSet.OK
    );
    
  } catch (e) {
    // If UI not available, log error
    Logger.log('❌ Error in setupDailySnapshot: ' + e.message);
    Logger.log('Note: This function must be run from the spreadsheet menu, not from Apps Script editor.');
    
    // Try to show error if possible
    try {
      SpreadsheetApp.getUi().alert('Error: ' + e.message + '\n\nPlease run this from the spreadsheet menu, not the Apps Script editor.');
    } catch (uiError) {
      // Can't show UI, just log
      Logger.log('Cannot display UI. Run this function from the spreadsheet menu: 📊 Portfolio Tracker > ⏰ Setup Daily Auto-Snapshot');
    }
  }
}

/**
 * Remove automated daily snapshot
 */
function removeDailySnapshot() {
  const ui = SpreadsheetApp.getUi();
  
  // Find and delete trigger
  const triggers = ScriptApp.getProjectTriggers();
  const snapshotTrigger = triggers.find(t => 
    t.getHandlerFunction() === 'savePortfolioSnapshot' && 
    t.getEventType() === ScriptApp.EventType.CLOCK
  );
  
  if (!snapshotTrigger) {
    ui.alert('No auto-snapshot is currently active.');
    return;
  }
  
  const response = ui.alert(
    'Remove Auto-Snapshot',
    'Are you sure you want to stop daily automatic snapshots?\n\n' +
    'You can still manually save snapshots anytime.',
    ui.ButtonSet.YES_NO
  );
  
  if (response === ui.Button.YES) {
    ScriptApp.deleteTrigger(snapshotTrigger);
    ui.alert('✅ Auto-snapshot removed. You can re-enable it anytime from the menu.');
  }
}

/**
 * Format hour for display
 */
function formatHour(hour) {
  if (hour === 0) return '12:00 AM (Midnight)';
  if (hour === 12) return '12:00 PM (Noon)';
  if (hour < 12) return hour + ':00 AM';
  return (hour - 12) + ':00 PM';
}