const express = require('express');
const authMiddleware = require('../config/auth.middleware');
const toCamel = require('../utils').toCamel;
const { query } = require('../config/database');

const router = express.Router();

router.post('/add-hosteler', authMiddleware, async (req, res) => {
    const { firstName, lastName, phone, email, idProof } = req.body;
    const cleanFirst = String(firstName || '').trim();
    const cleanPhone = String(phone || '').trim();

    if (!cleanFirst || !cleanPhone) {
        return res.status(400).json({ message: 'First name and phone are required' });
    }

    try {
        const result = await query(
            `INSERT INTO hosteler (first_name, last_name, phone, email, id_proof)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
            [cleanFirst, lastName || null, cleanPhone, email || null, idProof || null]
        );

        res.status(201).json({
            message: 'Hosteler added successfully',
            hosteler: toCamel(result.rows[0])
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error adding hosteler' });
    } 
});

router.put('/update-hosteler/:id', authMiddleware, async (req, res) => {
    // const client = req.dbClient;
    const { id } = req.params;
    const { firstName, lastName, phone, email, idProof } = req.body;
    const cleanFirst = String(firstName || '').trim();
    const cleanPhone = String(phone || '').trim();

    if (!cleanFirst || !cleanPhone) {
        return res.status(400).json({ message: 'First name and phone are required' });
    }

    try {
        const result = await query(
            `UPDATE hosteler
             SET first_name = $1,
                 last_name = $2,
                 phone = $3,
                 email = $4,
                 id_proof = $5
             WHERE hosteler_id = $6
             RETURNING *`,
            [cleanFirst, lastName || null, cleanPhone, email || null, idProof || null, id]
        );

        if (result.rows.length === 0)
            return res.status(404).json({ message: 'Hosteler not found' });

        res.json({
            message: 'Hosteler updated successfully',
            hosteler: toCamel(result.rows[0])
        });

    } catch (err) {
        res.status(500).json({ message: 'Error updating hosteler' });
    }
});

router.get('/get-hostelers', authMiddleware, async (req, res) => {
    try {
        const result = await query(`
            SELECT
                h.*,
                a.allocation_id,
                a.room_id,
                a.bed_id,
                a.check_in_date,
                b.bed_number,
                r.room_no,
                f.floor_no
            FROM hosteler h
            LEFT JOIN allocation a ON a.hosteler_id = h.hosteler_id AND a.status = 'active'
            LEFT JOIN bed b ON a.bed_id = b.bed_id
            LEFT JOIN room r ON b.room_id = r.room_id
            LEFT JOIN floor f ON r.floor_id = f.floor_id
            ORDER BY h.hosteler_id
        `);

        res.json({
            message: 'Hostelers fetched successfully',
            hostelers: result.rows.map(toCamel)
        });

    } catch (err) {
        res.status(500).json({ message: 'Error fetching hostelers' });
    }
});

router.get('/get-hosteler/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        const result = await query(
            'SELECT * FROM hosteler WHERE hosteler_id = $1',
            [id]
        );

        if (result.rows.length === 0)
            return res.status(404).json({ message: 'Hosteler not found' });

        res.json({
            message: 'Hosteler fetched successfully',
            hosteler: toCamel(result.rows[0])
        });

    } catch (err) {
        res.status(500).json({ message: 'Error fetching hosteler' });
    }
});

router.delete('/delete-hosteler/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;

    try {
        const active = await query(
            `SELECT 1 FROM allocation WHERE hosteler_id = $1 AND status = 'active'`,
            [id]
        );

        if (active.rows.length)
            return res.status(400).json({
                message: 'Cannot delete: hosteler has an active allocation. Check them out first.',
            });

        const result = await query(
            'DELETE FROM hosteler WHERE hosteler_id = $1 RETURNING *',
            [id]
        );

        if (result.rows.length === 0)
            return res.status(404).json({ message: 'Hosteler not found' });

        res.json({ message: 'Hosteler deleted successfully' });

    } catch (err) {
        res.status(500).json({
            message:
                err.code === '23503'
                    ? 'Cannot delete: hosteler has payment history. Mark them inactive instead.'
                    : 'Error deleting hosteler',
        });
    }
});

async function rollbackQuietly(client) {
    try {
        await client.query('ROLLBACK');
    } catch (rollbackErr) {
        console.error('Rollback failed', rollbackErr.message);
    }
}

router.post('/check-in', authMiddleware, async (req, res) => {
    const client = req.dbClient;
    const { hostelerId, roomId, bedId, checkInDate } = req.body;

    try {
        await client.query('BEGIN');

        const bed = await client.query(
            `SELECT status, room_id FROM bed WHERE bed_id = $1`,
            [bedId]
        );

        if (!bed.rows.length || bed.rows[0].status === 'occupied')
            throw new Error('Bed is not available');

        if (String(bed.rows[0].room_id) !== String(roomId))
            throw new Error('Bed does not belong to the selected room');

        const bedAllocation = await client.query(
            `SELECT 1 FROM allocation WHERE bed_id = $1 AND status = 'active'`,
            [bedId]
        );

        if (bedAllocation.rows.length)
            throw new Error('Bed already has an active stay');

        const activeAllocation = await client.query(
            `SELECT 1 FROM allocation WHERE hosteler_id = $1 AND status = 'active'`,
            [hostelerId]
        );

        if (activeAllocation.rows.length)
            throw new Error('Hosteler already has an active allocation');

        await client.query(
            `INSERT INTO allocation (hosteler_id, room_id, bed_id, check_in_date)
             VALUES ($1, $2, $3, $4)`,
            [hostelerId, roomId, bedId, checkInDate]
        );

        await client.query(
            `UPDATE bed SET status = 'occupied' WHERE bed_id = $1`,
            [bedId]
        );

        await client.query('COMMIT');

        res.json({status:"success" ,message: 'Check-in successful' });

    } catch (err) {
        await rollbackQuietly(client);
        res.status(400).json({status:"fail" ,message: err.message });
    }
});

router.post('/check-out', authMiddleware, async (req, res) => {
    const client = req.dbClient;
    const { allocationId, checkOutDate } = req.body;

    try {
        await client.query('BEGIN');

        const allocation = await client.query(
            `SELECT bed_id FROM allocation WHERE allocation_id = $1 AND status = 'active'`,
            [allocationId]
        );

        if (!allocation.rows.length)
            throw new Error('Active allocation not found');

        const bedId = allocation.rows[0].bed_id;

        await client.query(
            `UPDATE allocation
             SET status = 'left', check_out_date = $1
             WHERE allocation_id = $2`,
            [checkOutDate, allocationId]
        );

        await client.query(
            `UPDATE bed SET status = 'available' WHERE bed_id = $1`,
            [bedId]
        );

        await client.query('COMMIT');

        res.json({ status: 'success', message: 'Check-out successful' });

    } catch (err) {
        await rollbackQuietly(client);
        res.status(400).json({ message: err.message });
    } 
});

module.exports = router;