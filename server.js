const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
require('dotenv').config();
const { query, getClient } = require('./config/database');
const { toCamel } = require('./utils');
const jwt = require('jsonwebtoken');

const floorRoutes = require('./routes/floors');
const roomRoutes = require('./routes/rooms');
const bedRoutes = require('./routes/beds');
const hostelerRoutes = require('./routes/hostelers');
const paymentRoutes = require('./routes/payments');
const roomTypeRoutes = require('./routes/roomTypes');
const statsRoutes = require('./routes/stats');
const assetRoutes = require('./routes/assets');
const userRoutes = require('./routes/users');
const notificationRoutes = require('./routes/notifications');

const app = express();
const PORT = process.env.PORT || 5000;
const BCRYPT_ROUNDS = 10;
const isBcryptHash = (value) =>
  typeof value === 'string' && /^\$2[aby]\$\d{2}\$/.test(value);

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  next();
});

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'http://127.0.0.1:3000',
  'http://10.0.2.2:3000',
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('CORS origin not allowed'));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));

app.use('/floors', floorRoutes);
app.use('/rooms', roomRoutes);
app.use('/beds', bedRoutes);
app.use('/hostelers', hostelerRoutes);
app.use('/payments', paymentRoutes);
app.use('/room-types', roomTypeRoutes);
app.use('/stats', statsRoutes);
app.use('/assets', assetRoutes);
app.use('/users', userRoutes);
app.use('/notifications', notificationRoutes);

// Health Check
app.get('/health-check', (req, res) => {
  res.json({ message: 'Welcome to the Hostel Management System API' });
});

// POST /create-hostel - Onboard a new hostel + admin account
app.post('/create-hostel', async (req, res) => {
  let client;

  try {
    client = await getClient();

    const {
      hostelName,
      firstName,
      lastName,
      address,
      email,
      phone,
      password,
    } = req.body || {};

    const normalizedPhone = String(phone || '').trim();

    if (!String(hostelName || '').trim() || !String(firstName || '').trim() || !normalizedPhone || !password) {
      return res.status(400).json({
        status: 'fail',
        message: 'Hostel name, admin name, phone and password are required',
      });
    }

    if (String(password).length < 6) {
      return res.status(400).json({
        status: 'fail',
        message: 'Password must be at least 6 characters',
      });
    }

    await client.query('BEGIN');

    const existing = await client.query(
      'SELECT 1 FROM public.users WHERE phone = $1',
      [normalizedPhone]
    );

    if (existing.rowCount > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({
        status: 'fail',
        message: 'An account with this phone number already exists',
      });
    }

    const hostelResult = await client.query(
      `INSERT INTO public.hostel
         (hostel_name, phone, email, address)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [hostelName, normalizedPhone, email || null, address || null]
    );

    const hostel = hostelResult.rows[0];
    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const userResult = await client.query(
      `INSERT INTO public.users
         (first_name, last_name, phone, email, password, role, hostel_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING user_id, first_name, last_name, phone, email, role, hostel_id`,
      [
        firstName,
        lastName || null,
        normalizedPhone,
        email || null,
        passwordHash,
        'admin',
        hostel.hostel_id,
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      status: 'success',
      message: 'Hostel and admin account created successfully',
      hostel: toCamel(hostel),
      user: toCamel(userResult.rows[0]),
    });
  } catch (err) {
    try {
      if (client) await client.query('ROLLBACK');
    } catch (rollbackErr) {
      // ignore rollback failures
    }

    console.error('Create hostel error:', err);

    if (err.code === '23505') {
      return res.status(409).json({
        status: 'fail',
        message: 'An account with these details already exists',
      });
    }

    return res.status(500).json({
      status: 'fail',
      message: 'Error creating hostel account',
    });
  } finally {
    if (client) client.release();
  }
});

app.post('/login', async (req, res) => {
  try {
    const { phone, password } = req.body || {};

    if (!phone || !password) {
      return res.status(400).json({ message: 'Phone and password are required' });
    }

    const result = await query(
      `SELECT
         u.user_id, u.first_name, u.last_name, u.phone, u.email,
         u.role, u.hostel_id, u.password, u.status,
         h.hostel_name, h.address,
         h.phone AS hostel_phone, h.email AS hostel_email
       FROM public.users u
       JOIN public.hostel h ON u.hostel_id = h.hostel_id
       WHERE u.phone = $1`,
      [String(phone).trim()]
    );

    if (result.rowCount === 0) {
      return res.status(401).json({ message: 'Invalid phone or password' });
    }

    const user = result.rows[0];
    const storedPassword = user.password;

    let valid = false;
    if (isBcryptHash(storedPassword)) {
      valid = await bcrypt.compare(password, storedPassword);
    } else {
      // Backwards compatibility for accounts created before hashing was added.
      valid = password === storedPassword;
      if (valid) {
        const upgradedHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
        await query(
          'UPDATE public.users SET password = $1 WHERE user_id = $2',
          [upgradedHash, user.user_id]
        );
      }
    }

    if (!valid) {
      return res.status(401).json({ message: 'Invalid phone or password' });
    }

    if (user.status === false) {
      return res.status(403).json({ message: 'This account has been disabled' });
    }

    if (!process.env.JWT_SECRET) {
      console.error('JWT_SECRET is not configured');
      return res.status(500).json({ message: 'Server authentication is not configured' });
    }

    const token = jwt.sign(
      {
        userId: user.user_id,
        hostelId: user.hostel_id,
        role: user.role,
        schema: 'public',
      },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '30d' }
    );

    const safeUser = {
      userId: user.user_id,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      email: user.email,
      role: user.role,
      hostelId: user.hostel_id,
      hostelName: user.hostel_name,
      address: user.address,
      hostelPhone: user.hostel_phone,
      hostelEmail: user.hostel_email,
    };

    return res.json({ status: 'success', token, user: safeUser });
  } catch (err) {
    console.error('Login error:', err);
    return res.status(500).json({ message: 'Unable to sign in right now' });
  }
});

// 404 Handler (must be BELOW your routes)
app.use((req, res) => {
  res.status(404).json({ success: false, message: 'Route not found' });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    success: false,
    message: err.message || 'Internal server error',
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on 0.0.0.0:${PORT}`);
});

module.exports = app;
