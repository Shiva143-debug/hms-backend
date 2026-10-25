const express = require('express');
const authMiddleware = require('../config/auth.middleware');
const toCamel = require('../utils').toCamel;

const router = express.Router();

router.post('/add-room-type', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { typeName, description } = req.body;

  if (!typeName) {
    client.release();
    return res.status(400).json({ message: 'typeName is required' });
  }

  try {
    const result = await client.query(
      `INSERT INTO room_type (type_name, description)
       VALUES ($1, $2)
       RETURNING *`,
      [typeName, description]
    );

    res.status(201).json({
      message: 'Room type added successfully',
      roomType: toCamel(result.rows[0])
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error adding room type' });
  } finally {
    client.release();
  }
});

router.get('/get-room-types', authMiddleware, async (req, res) => {
  const client = req.dbClient;

  try {
    const result = await client.query(
      'SELECT * FROM room_type ORDER BY room_type_id'
    );

    res.json({
      message: 'Room types fetched successfully',
      roomTypes: result.rows.map(toCamel)
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching room types' });
  } finally {
    client.release();
  }
});

router.get('/get-room-type/:id', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { id } = req.params;

  try {
    const result = await client.query(
      'SELECT * FROM room_type WHERE room_type_id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: 'Room type not found' });
    }

    res.json({
      message: 'Room type fetched successfully',
      roomType: toCamel(result.rows[0])
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching room type' });
  } finally {
    client.release();
  }
});

router.put('/update-room-type/:id', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { id } = req.params;
  const { typeName, description } = req.body;

  try {
    const result = await client.query(
      `UPDATE room_type
       SET type_name = $1,
           description = $2
       WHERE room_type_id = $3
       RETURNING *`,
      [typeName, description, id]
    );

    if (result.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: 'Room type not found' });
    }

    res.json({
      message: 'Room type updated successfully',
      roomType: toCamel(result.rows[0])
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error updating room type' });
  } finally {
    client.release();
  }
});

router.delete('/delete-room-type/:id', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { id } = req.params;

  try {
    const result = await client.query(
      'DELETE FROM room_type WHERE room_type_id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: 'Room type not found' });
    }

    res.json({ message: 'Room type deleted successfully' });

  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error deleting room type' });
  } finally {
    client.release();
  }
});

module.exports = router;
