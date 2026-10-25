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

// Security
// app.use(helmet());
// app.use(express.json());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));


app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
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


async function onboardHostel(data) {
  const client = await getClient();

  try {
    await query('BEGIN');

    await query(
      `CALL public.onboard_hostel($1,$2,$3,$4,$5)`,
      [
        data.hostelName,
        data.adminName,
        data.email,
        data.phone,
        data.password
      ]
    );

    await query('COMMIT');
  } catch (err) {
    await query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// POST /hostels - Onboard a new hostel ✅
app.post('/create-hostel', async (req, res, next) => {

  try {
    await query('BEGIN');

     const { hostelName,firstName,lastName, address, email, phone, password } = req.body;

    // 1. Create hostel
    const hostelResult = await query(
      `INSERT INTO hostel 
      (hostel_name, phone, email, address) 
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
      [hostelName, phone, email, address]
    );

    const hostel = hostelResult.rows[0];

    // 2. Create user using the newly created hostel_id
    const userResult = await query(
      `INSERT INTO users
      (first_name, last_name, phone, email, password, role, hostel_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING user_id, first_name, last_name, phone, email, role, hostel_id`,
      [
        firstName,
        lastName,
        phone,
        email,
        password,
        "admin",
        hostel.hostel_id
      ]
    );

    await query('COMMIT');

    res.json({
      status: 'success',
      message: 'Hostel and user added successfully',
      hostel: toCamel(hostel),
      user: toCamel(userResult.rows[0])
    });

  } catch (err) {
    await query('ROLLBACK');

    console.error(err);

    res.status(500).json({
      status: 'fail',
      message: 'Error adding hostel and user'
    });

  }
})


app.post('/login', async (req, res, next) => {
  try {
    const { phone, password } = req.body;

    const result = await query(`
      SELECT * 
      FROM public.users u
      JOIN public.hostel h ON u.hostel_id = h.hostel_id
      WHERE u.phone = $1
    `, [phone]);

    if (result.rowCount === 0)
      return res.status(401).json({ message: 'User not found' });

    const user = result.rows[0];

    // const valid = await bcrypt.compare(password, user.password);
    const valid = password === user.password;
    if (!valid)
      return res.status(401).json({ message: 'Wrong password' });

    const token = jwt.sign(
      { userId: user.user_id, hostelId: user.hostel_id, schema: 'public' },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({status:'success', token, user: toCamel(user) });
  } catch (err) {
    return next(err);
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
    message: err.message || 'Internal server error'
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`🚀 Server running on 0.0.0.0:${PORT}`);
});

module.exports = app;
