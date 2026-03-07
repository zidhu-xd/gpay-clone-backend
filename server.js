const express = require('express');
const cors = require('cors');
const path = require('path');

const authRoutes = require('./routes/auth');
const usersRoutes = require('./routes/users');
const paymentsRoutes = require('./routes/payments');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/payments', paymentsRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root
app.get('/', (req, res) => {
  res.json({
    message: 'GPay Clone Backend API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth (POST /register, POST /login, GET /profile, PUT /profile)',
      users: '/api/users (GET /, GET /search, GET /contacts, GET /bank-accounts, POST /bank-accounts, GET /:id)',
      payments: '/api/payments (POST /send, POST /self-transfer, POST /recharge, GET /history, GET /billers, GET /offers, GET /businesses, GET /balance, POST /scratch-card/:id, POST /redeem-rewards, GET /events)'
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Something went wrong!' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`╔══════════════════════════════════════╗`);
  console.log(`║   GPay Clone Backend Server          ║`);
  console.log(`║   Running on http://0.0.0.0:${PORT}    ║`);
  console.log(`╚══════════════════════════════════════╝`);
});
