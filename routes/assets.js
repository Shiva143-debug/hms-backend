const express = require('express');
const authMiddleware = require('../config/auth.middleware');
const toCamel = require('../utils').toCamel;
const { query } = require('../config/database');

const router = express.Router();

const DEFAULT_ASSETS = ['Fan', 'Bulb', 'Charging Point', 'Cupboard', 'Table'];

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS public.asset (
      asset_id      BIGSERIAL PRIMARY KEY,
      room_id       BIGINT NOT NULL REFERENCES public.room(room_id) ON DELETE CASCADE,
      name          VARCHAR(50) NOT NULL,
      quantity      INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

// Ensure the table exists before the router handles requests.
ensureTable().catch((err) => console.error('Asset table init error:', err.message));

router.get('/get-assets', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  try {
    const result = await client.query(`
      SELECT a.*, r.room_no, f.floor_no, rt.type_name
      FROM asset a
      LEFT JOIN room r ON a.room_id = r.room_id
      LEFT JOIN floor f ON r.floor_id = f.floor_id
      LEFT JOIN room_type rt ON r.room_type_id = rt.room_type_id
      ORDER BY f.floor_no, r.room_no, a.name
    `);

    res.json({
      message: 'Assets fetched successfully',
      assets: result.rows.map(toCamel)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching assets' });
  } finally {
    client.release();
  }
});

// Seed default categories for a room if not present.
router.post('/init-room-assets/:roomId', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { roomId } = req.params;

  try {
    const existing = await client.query(
      'SELECT name FROM asset WHERE room_id = $1',
      [roomId]
    );
    const present = new Set(existing.rows.map((r) => r.name));

    for (const name of DEFAULT_ASSETS) {
      if (!present.has(name)) {
        await client.query(
          'INSERT INTO asset (room_id, name, quantity) VALUES ($1, $2, 0)',
          [roomId, name]
        );
      }
    }

    const result = await client.query(
      'SELECT * FROM asset WHERE room_id = $1 ORDER BY name',
      [roomId]
    );

    res.json({
      message: 'Room assets initialised',
      assets: result.rows.map(toCamel)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error initialising room assets' });
  } finally {
    client.release();
  }
});

router.post('/add-asset', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { roomId, name, quantity } = req.body;

  if (!roomId || !name) {
    client.release();
    return res.status(400).json({ message: 'roomId and name are required' });
  }

  try {
    const result = await client.query(
      'INSERT INTO asset (room_id, name, quantity) VALUES ($1, $2, $3) RETURNING *',
      [roomId, name, quantity || 0]
    );

    res.status(201).json({
      message: 'Asset added successfully',
      asset: toCamel(result.rows[0])
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error adding asset' });
  } finally {
    client.release();
  }
});

router.put('/update-asset/:id', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { id } = req.params;
  const { name, quantity } = req.body;

  try {
    const result = await client.query(
      `UPDATE asset
       SET name = COALESCE($1, name),
           quantity = COALESCE($2, quantity)
       WHERE asset_id = $3
       RETURNING *`,
      [name || null, quantity != null ? quantity : null, id]
    );

    if (result.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: 'Asset not found' });
    }

    res.json({
      message: 'Asset updated successfully',
      asset: toCamel(result.rows[0])
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error updating asset' });
  } finally {
    client.release();
  }
});

router.delete('/delete-asset/:id', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { id } = req.params;

  try {
    const result = await client.query(
      'DELETE FROM asset WHERE asset_id = $1 RETURNING *',
      [id]
    );

    if (result.rows.length === 0) {
      client.release();
      return res.status(404).json({ message: 'Asset not found' });
    }

    res.json({ message: 'Asset deleted successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error deleting asset' });
  } finally {
    client.release();
  }
});

module.exports = router;