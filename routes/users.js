const express = require('express');
const authMiddleware = require('../config/auth.middleware');
const toCamel = require('../utils').toCamel;

const router = express.Router();

// Current logged-in user + their hostel
router.get('/profile', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const userId = req.user.userId;

  try {
    const result = await client.query(
      `SELECT u.user_id, u.first_name, u.last_name, u.phone, u.email, u.role,
              h.*
       FROM users u
       JOIN hostel h ON u.hostel_id = h.hostel_id
       WHERE u.user_id = $1`,
      [userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Profile fetched successfully',
      profile: toCamel(result.rows[0])
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching profile' });
  } finally {
    client.release();
  }
});

// Update the current user's public details
router.put('/update-profile', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const userId = req.user.userId;
  const { firstName, lastName, phone, email } = req.body;

  try {
    const result = await client.query(
      `UPDATE users
       SET first_name = COALESCE($1, first_name),
           last_name  = COALESCE($2, last_name),
           phone      = COALESCE($3, phone),
           email      = COALESCE($4, email)
       WHERE user_id = $5
       RETURNING user_id, first_name, last_name, phone, email, role`,
      [firstName || null, lastName || null, phone || null, email || null, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({
      message: 'Profile updated successfully',
      user: toCamel(result.rows[0])
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error updating profile' });
  } finally {
    client.release();
  }
});

module.exports = router;