const express = require('express');
const authMiddleware = require('../config/auth.middleware');
const toCamel = require('../utils').toCamel;
const { query } = require('../config/database');

const router = express.Router();

router.post('/add-hosteler', authMiddleware, async (req, res) => {
    const { firstName, lastName, phone, email, idProof } = req.body;

    try {
        const result = await query(
            `INSERT INTO hosteler (first_name, last_name, phone, email, id_proof)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
            [firstName, lastName, phone, email, idProof]
        );

        res.status(201).json({
            message: 'Hosteler added successfully',
            hosteler: result.rows[0]
        });

    } catch (err) {
        res.status(500).json({ message: 'Error adding hosteler' });
    } 
});

router.put('/update-hosteler/:id', authMiddleware, async (req, res) => {
    // const client = req.dbClient;
    const { id } = req.params;
    const { firstName, lastName, phone, email, idProof } = req.body;

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
            [firstName, lastName, phone, email, idProof, id]
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

router.post('/check-in', authMiddleware, async (req, res) => {
    // const client = req.dbClient;
    const { hostelerId, roomId, bedId, checkInDate } = req.body;

    try {
        await query('BEGIN');

        const bed = await query(
            `SELECT status FROM bed WHERE bed_id = $1`,
            [bedId]
        );

        if (!bed.rows.length || bed.rows[0].status !== 'available')
            throw new Error('Bed is not available');

        const activeAllocation = await query(
            `SELECT 1 FROM allocation WHERE hosteler_id = $1 AND status = 'active'`,
            [hostelerId]
        );

        if (activeAllocation.rows.length)
            throw new Error('Hosteler already has an active allocation');

        await query(
            `INSERT INTO allocation (hosteler_id, room_id, bed_id, check_in_date)
             VALUES ($1, $2, $3, $4)`,
            [hostelerId, roomId, bedId, checkInDate]
        );

        await query(
            `UPDATE bed SET status = 'occupied' WHERE bed_id = $1`,
            [bedId]
        );

        await query('COMMIT');

        res.json({status:"success" ,message: 'Check-in successful' });

    } catch (err) {
        await query('ROLLBACK');
        res.status(400).json({status:"fail" ,message: err.message });
    }
});

router.post('/check-out', authMiddleware, async (req, res) => {
    // const client = req.dbClient;
    const { allocationId, checkOutDate } = req.body;

    try {
        await query('BEGIN');

        const allocation = await query(
            `SELECT bed_id FROM allocation WHERE allocation_id = $1 AND status = 'active'`,
            [allocationId]
        );

        if (!allocation.rows.length)
            throw new Error('Active allocation not found');

        const bedId = allocation.rows[0].bed_id;

        await query(
            `UPDATE allocation
             SET status = 'left', check_out_date = $1
             WHERE allocation_id = $2`,
            [checkOutDate, allocationId]
        );

        await query(
            `UPDATE bed SET status = 'available' WHERE bed_id = $1`,
            [bedId]
        );

        await query('COMMIT');

        res.json({staus:"success" ,message: 'Check-out successful' });

    } catch (err) {
        await query('ROLLBACK');
        res.status(400).json({ message: err.message });
    } 
});

module.exports = router;

module.exports = router;