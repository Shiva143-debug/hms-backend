const express = require('express');
const authMiddleware = require('../config/auth.middleware');
const toCamel = require('../utils').toCamel;
const { query } = require('../config/database');

const router = express.Router();

router.post('/add-room', authMiddleware, async (req, res) => {
  
  const { floorId, roomNumber, roomTypeId,  priceMonthly, priceDaily } = req.body;

  try {
    const result = await query(
      `INSERT INTO room (floor_id, room_no, room_type_id, price_monthly, price_daily)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [floorId, roomNumber, roomTypeId, priceMonthly, priceDaily]
    );

    res.status(201).json({
      message: 'Room added successfully',
      room: toCamel(result.rows[0])
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error adding room' });
  }
});

router.get('/get-rooms', authMiddleware, async (req, res) => {
  const client = req.dbClient;

  try {
    const result = await client.query(`
      SELECT r.*, f.floor_no, rt.type_name
      FROM room r
      LEFT JOIN floor f ON r.floor_id = f.floor_id
      LEFT JOIN room_type rt ON r.room_type_id = rt.room_type_id
      ORDER BY r.room_id
    `);

    res.json({
      message: 'Rooms fetched successfully',
      rooms: result.rows.map(toCamel)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching rooms' });
  } finally {
    client.release();
  }
});

router.get('/get-room/:id', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { id } = req.params;

  try {
    const result = await client.query(
      `SELECT r.*, f.floor_no, rt.type_name
       FROM room r
       LEFT JOIN floor f ON r.floor_id = f.floor_id
       LEFT JOIN room_type rt ON r.room_type_id = rt.room_type_id
       WHERE r.room_id = $1`,
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Room not found' });
       const row = toCamel(result.rows[0])
    return res.status(200).json({ message: 'Room Fetched Successfully' , room: row });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching room' });
  } finally {
    client.release();
  }
});

router.put('/update-room/:id', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { id } = req.params;
  const { floorId, roomNumber, roomTypeId, capacity, priceMonthly, priceDaily } = req.body;

  try {
    const result = await query(
      `UPDATE room
       SET floor_id = $1,
           room_no = $2,
           room_type_id = $3,
           price_monthly = $4,
           price_daily = $5
       WHERE room_id = $6
       RETURNING *`,
      [floorId, roomNumber, roomTypeId, priceMonthly, priceDaily, id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Room not found' });

    res.json({
      message: 'Room updated successfully',
      room: toCamel(result.rows[0])
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error updating room' });
  } finally {
    client.release();
  }
});

router.delete('/delete-room/:id', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { id } = req.params;

  try {
    const result = await client.query(
      'DELETE FROM room WHERE room_id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: 'Room not found' });

    res.json({ message: 'Room deleted successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error deleting room' });
  } finally {
    client.release();
  }
});

module.exports = router;