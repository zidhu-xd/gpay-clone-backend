const express = require('express');
const { readJsonFile, writeJsonFile, generateId, generateUpiRefId } = require('../utils/fileUtils');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// SSE clients for real-time updates
let sseClients = new Map();

// SSE endpoint for real-time transaction updates
router.get('/events', authMiddleware, (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  const clientId = req.userId;
  sseClients.set(clientId, res);

  res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'SSE connected' })}\n\n`);

  req.on('close', () => {
    sseClients.delete(clientId);
  });
});

function notifyClient(userId, data) {
  const client = sseClients.get(userId);
  if (client) {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  }
}

// Send money to another user
router.post('/send', authMiddleware, (req, res) => {
  try {
    const { receiverId, amount, note, upiPin } = req.body;

    if (!receiverId || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Receiver and valid amount required.' });
    }

    if (!upiPin || upiPin.length < 4) {
      return res.status(400).json({ error: 'Valid UPI PIN required.' });
    }

    const usersData = readJsonFile('users.json');
    const appData = readJsonFile('app-data.json');
    if (!usersData || !appData) return res.status(500).json({ error: 'Server error.' });

    const senderIndex = usersData.users.findIndex(u => u.id === req.userId);
    const receiverIndex = usersData.users.findIndex(u => u.id === receiverId);

    if (senderIndex === -1) return res.status(404).json({ error: 'Sender not found.' });
    if (receiverIndex === -1) return res.status(404).json({ error: 'Receiver not found.' });

    const sender = usersData.users[senderIndex];
    const receiver = usersData.users[receiverIndex];

    if (sender.balance < amount) {
      return res.status(400).json({ error: 'Insufficient balance.' });
    }

    // Process transaction
    usersData.users[senderIndex].balance -= amount;
    usersData.users[receiverIndex].balance += amount;

    // Update primary bank account balances
    const senderPrimaryBank = sender.bankAccounts.find(b => b.isPrimary);
    const receiverPrimaryBank = receiver.bankAccounts.find(b => b.isPrimary);
    if (senderPrimaryBank) senderPrimaryBank.balance -= amount;
    if (receiverPrimaryBank) receiverPrimaryBank.balance += amount;

    const transaction = {
      id: generateId('txn'),
      senderId: sender.id,
      receiverId: receiver.id,
      senderName: sender.name,
      receiverName: receiver.name,
      amount: parseFloat(amount),
      type: 'TRANSFER',
      status: 'SUCCESS',
      note: note || '',
      timestamp: new Date().toISOString(),
      upiRefId: generateUpiRefId()
    };

    appData.transactions.unshift(transaction);

    // Award reward points (1 point per ₹100)
    const points = Math.floor(amount / 100);
    usersData.users[senderIndex].rewardPoints += points;

    // Random scratch card chance (30%)
    if (Math.random() < 0.3) {
      const scratchCard = {
        id: generateId('sc'),
        amount: Math.floor(Math.random() * 100) + 10,
        isScratched: false,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      };
      usersData.users[senderIndex].scratchCards.push(scratchCard);
      transaction.scratchCard = scratchCard;
    }

    writeJsonFile('users.json', usersData);
    writeJsonFile('app-data.json', appData);

    // Notify receiver via SSE
    notifyClient(receiver.id, {
      type: 'PAYMENT_RECEIVED',
      transaction
    });

    res.json({
      message: 'Payment successful!',
      transaction,
      newBalance: usersData.users[senderIndex].balance,
      rewardPoints: points
    });
  } catch (error) {
    console.error('Send money error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Self transfer between bank accounts
router.post('/self-transfer', authMiddleware, (req, res) => {
  try {
    const { fromBankId, toBankId, amount, upiPin } = req.body;

    if (!fromBankId || !toBankId || !amount || amount <= 0) {
      return res.status(400).json({ error: 'Both bank accounts and valid amount required.' });
    }

    if (!upiPin || upiPin.length < 4) {
      return res.status(400).json({ error: 'Valid UPI PIN required.' });
    }

    const usersData = readJsonFile('users.json');
    const appData = readJsonFile('app-data.json');
    if (!usersData || !appData) return res.status(500).json({ error: 'Server error.' });

    const userIndex = usersData.users.findIndex(u => u.id === req.userId);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    const user = usersData.users[userIndex];
    const fromBank = user.bankAccounts.find(b => b.id === fromBankId);
    const toBank = user.bankAccounts.find(b => b.id === toBankId);

    if (!fromBank || !toBank) return res.status(404).json({ error: 'Bank account not found.' });
    if (fromBank.balance < amount) return res.status(400).json({ error: 'Insufficient balance.' });

    fromBank.balance -= amount;
    toBank.balance += amount;

    const transaction = {
      id: generateId('txn'),
      senderId: user.id,
      receiverId: 'SELF',
      senderName: user.name,
      receiverName: user.name,
      amount: parseFloat(amount),
      type: 'SELF_TRANSFER',
      status: 'SUCCESS',
      note: `Transfer from ${fromBank.bankName} to ${toBank.bankName}`,
      fromBank: fromBankId,
      toBank: toBankId,
      timestamp: new Date().toISOString(),
      upiRefId: generateUpiRefId()
    };

    appData.transactions.unshift(transaction);
    writeJsonFile('users.json', usersData);
    writeJsonFile('app-data.json', appData);

    res.json({
      message: 'Self transfer successful!',
      transaction,
      fromBankBalance: fromBank.balance,
      toBankBalance: toBank.balance
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Pay bill / Recharge
router.post('/recharge', authMiddleware, (req, res) => {
  try {
    const { billerId, planId, mobileNumber, amount, upiPin } = req.body;

    if (!amount || amount <= 0 || !upiPin) {
      return res.status(400).json({ error: 'Valid amount and UPI PIN required.' });
    }

    const usersData = readJsonFile('users.json');
    const appData = readJsonFile('app-data.json');
    if (!usersData || !appData) return res.status(500).json({ error: 'Server error.' });

    const userIndex = usersData.users.findIndex(u => u.id === req.userId);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    const user = usersData.users[userIndex];
    if (user.balance < amount) return res.status(400).json({ error: 'Insufficient balance.' });

    // Find biller
    const biller = appData.billers.find(b => b.id === billerId);
    const billerName = biller ? biller.name : 'Recharge';

    usersData.users[userIndex].balance -= amount;
    const primaryBank = user.bankAccounts.find(b => b.isPrimary);
    if (primaryBank) primaryBank.balance -= amount;

    const transaction = {
      id: generateId('txn'),
      senderId: user.id,
      receiverId: `BILL_${billerName.toUpperCase().replace(/\s+/g, '_')}`,
      senderName: user.name,
      receiverName: `${billerName} ${mobileNumber || ''}`.trim(),
      amount: parseFloat(amount),
      type: 'RECHARGE',
      status: 'SUCCESS',
      note: `${billerName} recharge`,
      timestamp: new Date().toISOString(),
      upiRefId: generateUpiRefId()
    };

    appData.transactions.unshift(transaction);

    const points = Math.floor(amount / 100);
    usersData.users[userIndex].rewardPoints += points;

    writeJsonFile('users.json', usersData);
    writeJsonFile('app-data.json', appData);

    res.json({
      message: 'Recharge successful!',
      transaction,
      newBalance: usersData.users[userIndex].balance,
      rewardPoints: points
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Get transaction history
router.get('/history', authMiddleware, (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const appData = readJsonFile('app-data.json');
    if (!appData) return res.status(500).json({ error: 'Server error.' });

    const userTransactions = appData.transactions.filter(
      t => t.senderId === req.userId || t.receiverId === req.userId
    );

    const start = (page - 1) * limit;
    const paginatedTxns = userTransactions.slice(start, start + parseInt(limit));

    res.json({
      transactions: paginatedTxns,
      total: userTransactions.length,
      page: parseInt(page),
      totalPages: Math.ceil(userTransactions.length / limit)
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Get billers
router.get('/billers', authMiddleware, (req, res) => {
  try {
    const { category } = req.query;
    const appData = readJsonFile('app-data.json');
    if (!appData) return res.status(500).json({ error: 'Server error.' });

    let billers = appData.billers;
    if (category) {
      billers = billers.filter(b => b.category === category);
    }

    res.json({ billers });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Get offers
router.get('/offers', authMiddleware, (req, res) => {
  try {
    const appData = readJsonFile('app-data.json');
    if (!appData) return res.status(500).json({ error: 'Server error.' });

    res.json({ offers: appData.offers });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Get businesses
router.get('/businesses', authMiddleware, (req, res) => {
  try {
    const appData = readJsonFile('app-data.json');
    if (!appData) return res.status(500).json({ error: 'Server error.' });

    res.json({ businesses: appData.businesses });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Scratch card
router.post('/scratch-card/:cardId', authMiddleware, (req, res) => {
  try {
    const { cardId } = req.params;
    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const userIndex = usersData.users.findIndex(u => u.id === req.userId);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    const cardIndex = usersData.users[userIndex].scratchCards.findIndex(c => c.id === cardId);
    if (cardIndex === -1) return res.status(404).json({ error: 'Scratch card not found.' });

    const card = usersData.users[userIndex].scratchCards[cardIndex];
    if (card.isScratched) return res.status(400).json({ error: 'Card already scratched.' });

    card.isScratched = true;
    usersData.users[userIndex].balance += card.amount;
    usersData.users[userIndex].rewardPoints += card.amount;

    writeJsonFile('users.json', usersData);

    res.json({
      message: `You won ₹${card.amount}!`,
      amount: card.amount,
      newBalance: usersData.users[userIndex].balance
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Redeem reward points
router.post('/redeem-rewards', authMiddleware, (req, res) => {
  try {
    const { points } = req.body;
    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const userIndex = usersData.users.findIndex(u => u.id === req.userId);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    const user = usersData.users[userIndex];
    if (user.rewardPoints < points) {
      return res.status(400).json({ error: 'Insufficient reward points.' });
    }

    const cashValue = points * 0.1; // 10 points = ₹1
    usersData.users[userIndex].rewardPoints -= points;
    usersData.users[userIndex].balance += cashValue;

    writeJsonFile('users.json', usersData);

    res.json({
      message: `Redeemed ${points} points for ₹${cashValue}!`,
      redeemedPoints: points,
      cashValue,
      remainingPoints: usersData.users[userIndex].rewardPoints,
      newBalance: usersData.users[userIndex].balance
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Check balance
router.get('/balance', authMiddleware, (req, res) => {
  try {
    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const user = usersData.users.find(u => u.id === req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    res.json({
      balance: user.balance,
      bankAccounts: user.bankAccounts.map(b => ({
        id: b.id,
        bankName: b.bankName,
        accountNumber: b.accountNumber,
        balance: b.balance,
        isPrimary: b.isPrimary
      }))
    });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
