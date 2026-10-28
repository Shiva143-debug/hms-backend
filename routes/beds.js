const express = require('express');
const authMiddleware = require('../config/auth.middleware');
const toCamel = require('../utils').toCamel;
const { query } = require('../config/database');

const router = express.Router();


router.post('/add-bed', authMiddleware, async (req, res) => {
    // const client = req.dbClient;
    const { roomId, bedNumber } = req.body;

    try {
        const result = await query(
            `INSERT INTO bed (room_id, bed_number)
       VALUES ($1, $2)
       RETURNING *`,
            [roomId, bedNumber]
        );

        res.status(201).json({
            message: 'Bed added successfully',
            bed: toCamel(result.rows[0])
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error adding bed' });
    } 
});

router.get('/get-beds', authMiddleware, async (req, res) => {
    const client = req.dbClient;

    try {
        const result = await client.query(`
      SELECT 
        b.bed_id,
        b.bed_number,
        b.status,
        r.room_no,
        f.floor_no
      FROM bed b
      JOIN room r ON b.room_id = r.room_id
      JOIN floor f ON r.floor_id = f.floor_id
      ORDER BY b.bed_id
    `);

        res.json({
            message: 'Beds fetched successfully',
            beds: result.rows.map(toCamel)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching beds' });
    } finally {
        client.release();
    }
});

router.get('/get-bed/:id', authMiddleware, async (req, res) => {
    const client = req.dbClient;
    const { id } = req.params;

    try {
        const result = await client.query(`
      SELECT 
        b.bed_id,
        b.bed_number,
        b.status,
        r.room_no,
        f.floor_no
      FROM bed b
      JOIN room r ON b.room_id = r.room_id
      JOIN floor f ON r.floor_id = f.floor_id
      WHERE b.bed_id = $1
      ORDER BY b.bed_id
    `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ message: 'Bed not found' });
        }

        res.json({
            message: 'Bed fetched successfully',
            bed: toCamel(result.rows[0]),
            beds: result.rows.map(toCamel)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching beds' });
    } finally {
        client.release();
    }
});

router.get('/get-beds-by-room/:roomId', authMiddleware, async (req, res) => {
    const client = req.dbClient;
    const { roomId } = req.params;

    try {
        const result = await client.query(
            `SELECT * FROM bed WHERE room_id = $1 ORDER BY bed_number`,
            [roomId]
        );

        res.json({
            message: 'Beds fetched successfully',
            beds: result.rows.map(toCamel)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching beds' });
    } finally {
        client.release();
    }
});

router.put('/update-bed/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { bedNumber, status } = req.body;

    try {
        const result = await query(
            `UPDATE bed
       SET bed_number = COALESCE($1, bed_number),
           status = COALESCE($2, status)
       WHERE bed_id = $3
       RETURNING *`,
            [bedNumber || null, status || null, id]
        );

        if (result.rows.length === 0)
            return res.status(404).json({ message: 'Bed not found' });

        res.json({
            message: 'Bed updated successfully',
            bed: toCamel(result.rows[0])
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error updating bed' });
    } 
});

router.delete('/delete-bed/:id', authMiddleware, async (req, res) => {
    const client = req.dbClient;
    const { id } = req.params;

    try {
        const result = await client.query(
            `DELETE FROM bed WHERE bed_id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0)
            return res.status(404).json({ message: 'Bed not found' });

        res.json({ message: 'Bed deleted successfully' });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error deleting bed' });
    } finally {
        client.release();
    }
});


module.exports = router;