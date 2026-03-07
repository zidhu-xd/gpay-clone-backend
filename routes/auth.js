const express = require('express');
const bcrypt = require('bcryptjs');
const { readJsonFile, writeJsonFile, generateId } = require('../utils/fileUtils');
const { generateToken } = require('../middleware/auth');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

// Register
router.post('/register', async (req, res) => {
  try {
    const { name, email, phone, password, upiId } = req.body;
    
    if (!name || !phone || !password) {
      return res.status(400).json({ error: 'Name, phone, and password are required.' });
    }

    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const existingUser = usersData.users.find(u => u.phone === phone);
    if (existingUser) {
      return res.status(409).json({ error: 'User with this phone already exists.' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const userId = generateId('user');

    const newUser = {
      id: userId,
      name,
      email: email || '',
      phone,
      password: hashedPassword,
      upiId: upiId || `${name.toLowerCase().replace(/\s+/g, '')}@okbank`,
      avatar: name.charAt(0).toUpperCase(),
      balance: 10000.00,
      bankAccounts: [
        {
          id: generateId('bank'),
          bankName: 'State Bank of India',
          accountNumber: `XXXX XXXX ${Math.floor(1000 + Math.random() * 9000)}`,
          ifsc: 'SBIN0001234',
          balance: 10000.00,
          isPrimary: true,
          logo: 'sbi'
        }
      ],
      rewardPoints: 0,
      scratchCards: [],
      createdAt: new Date().toISOString()
    };

    usersData.users.push(newUser);
    writeJsonFile('users.json', usersData);

    const token = generateToken(userId);
    const { password: _, ...userWithoutPassword } = newUser;

    res.status(201).json({
      message: 'User registered successfully.',
      token,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Login
router.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body;
    
    if (!phone || !password) {
      return res.status(400).json({ error: 'Phone and password are required.' });
    }

    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const user = usersData.users.find(u => u.phone === phone);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // For demo: accept "password123" for pre-seeded users
    let isValidPassword = false;
    try {
      isValidPassword = await bcrypt.compare(password, user.password);
    } catch (e) {
      // If bcrypt compare fails (pre-seeded hashes), allow demo password
      if (password === 'password123') isValidPassword = true;
    }

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = generateToken(user.id);
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      message: 'Login successful.',
      token,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Get current user profile
router.get('/profile', authMiddleware, (req, res) => {
  try {
    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const user = usersData.users.find(u => u.id === req.userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });

    const { password, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// Update profile
router.put('/profile', authMiddleware, (req, res) => {
  try {
    const { name, email } = req.body;
    const usersData = readJsonFile('users.json');
    if (!usersData) return res.status(500).json({ error: 'Server error.' });

    const userIndex = usersData.users.findIndex(u => u.id === req.userId);
    if (userIndex === -1) return res.status(404).json({ error: 'User not found.' });

    if (name) usersData.users[userIndex].name = name;
    if (email) usersData.users[userIndex].email = email;

    writeJsonFile('users.json', usersData);

    const { password, ...userWithoutPassword } = usersData.users[userIndex];
    res.json({ message: 'Profile updated.', user: userWithoutPassword });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
