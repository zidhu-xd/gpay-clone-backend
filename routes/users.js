const express = require('express');
const { readJsonFile, writeJsonFile, generateId } = require('../utils/fileUtils');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Get all users (contacts)
router.get('/', authMiddleware, (req, res) => {
  try {
    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const users = usersData.users
      .filter(u => u.id !== req.userId)
      .map(({ password, balance, bankAccounts, ...rest }) => rest);

    res.json({ users });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Search users by name, phone, or UPI ID
router.get('/search', authMiddleware, (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.status(400).json({ error: 'Search query required.' });

    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const query = q.toLowerCase();
    const results = usersData.users
      .filter(u => u.id !== req.userId && (
        u.name.toLowerCase().includes(query) ||
        u.phone.includes(query) ||
        u.upiId.toLowerCase().includes(query)
      ))
      .map(({ password, balance, bankAccounts, ...rest }) => rest);

    res.json({ users: results });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Get contacts for the authenticated user
router.get('/contacts', authMiddleware, (req, res) => {
  try {
    const appData = readJsonFile('app-data.json');
    if (!appData) return res.status(500).json({ error: 'Server error.' });

    res.json({ contacts: appData.contacts });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Get bank accounts
router.get('/bank-accounts', authMiddleware, (req, res) => {
  try {
    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const user = usersData.users.find(u => u.id === req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    res.json({ bankAccounts: user.bankAccounts });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Add bank account
router.post('/bank-accounts', authMiddleware, (req, res) => {
  try {
    const { bankName, accountNumber, ifsc } = req.body;
    if (!bankName || !accountNumber) {
      return res.status(400).json({ error: 'Bank name and account number required.' });
    }

    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const userIndex = usersData.users.findIndex(u => u.id === req.userId);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    const newAccount = {
      id: generateId('bank'),
      bankName,
      accountNumber: `XXXX XXXX ${accountNumber.slice(-4)}`,
      ifsc: ifsc || 'UNKN0000001',
      balance: 0,
      isPrimary: usersData.users[userIndex].bankAccounts.length === 0,
      logo: bankName.toLowerCase().replace(/\s+/g, '').substring(0, 4)
    };

    usersData.users[userIndex].bankAccounts.push(newAccount);
    writeJsonFile('users.json', usersData);

    res.status(201).json({ message: 'Bank account added.', bankAccount: newAccount });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Get user by ID
router.get('/:id', authMiddleware, (req, res) => {
  try {
    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const user = usersData.users.find(u => u.id === req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const { password, balance, bankAccounts, ...publicUser } = user;
    res.json({ user: publicUser });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
