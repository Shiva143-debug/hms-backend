const express = require('express');
const authMiddleware = require('../config/auth.middleware');
const toCamel = require('../utils').toCamel;

const router = express.Router();

// Aggregate numbers for the mobile dashboard
router.get('/dashboard', authMiddleware, async (req, res) => {
    const client = req.dbClient;

    try {
        const [floors, rooms, beds, occupants, hostelers, invoiceAgg, paymentAgg] = await Promise.all([
            client.query('SELECT COUNT(*)::int AS count FROM floor'),
            client.query('SELECT COUNT(*)::int AS count FROM room'),
            client.query('SELECT COUNT(*)::int AS count FROM bed'),
            client.query(`SELECT COUNT(*)::int AS count FROM allocation WHERE status = 'active'`),
            client.query(`SELECT COUNT(*)::int AS count FROM hosteler WHERE status = 'active'`),
            client.query(
                `SELECT
                    COALESCE(SUM(CASE WHEN status <> 'paid' THEN amount ELSE 0 END), 0)::numeric AS pending_amount,
                    COUNT(*) FILTER (WHERE status <> 'paid' AND due_date < CURRENT_DATE)::int AS overdue_count,
                    COUNT(*) FILTER (WHERE status <> 'paid' AND due_date BETWEEN (CURRENT_DATE - 1) AND (CURRENT_DATE + 1))::int AS due_soon_count
                 FROM invoice`
            ),
            client.query('SELECT COALESCE(SUM(amount), 0)::numeric AS collected FROM payment')
        ]);

        const available = beds.rows[0].count - occupants.rows[0].count;

        res.json({
            message: 'Dashboard stats fetched successfully',
            floors: floors.rows[0].count,
            rooms: rooms.rows[0].count,
            beds: beds.rows[0].count,
            occupiedBeds: occupants.rows[0].count,
            availableBeds: available,
            hostelers: hostelers.rows[0].count,
            amountCollected: parseFloat(paymentAgg.rows[0].collected),
            amountPending: parseFloat(invoiceAgg.rows[0].pending_amount),
            overdue: invoiceAgg.rows[0].overdue_count,
            dueSoon: invoiceAgg.rows[0].due_soon_count
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching dashboard stats' });
    } finally {
        client.release();
    }
});

// Stats based on hostel_id: floors count, rooms, beds, active hostelers
router.get('/hostel-stats', authMiddleware, async (req, res) => {
    const client = req.dbClient;

    try {
        const [floors, rooms, beds, hostelers] = await Promise.all([
            client.query('SELECT COUNT(*)::int AS count FROM floor'),
            client.query(`SELECT COUNT(*)::int AS count FROM room r JOIN floor f ON r.floor_id = f.floor_id `),
            client.query(`SELECT COUNT(*)::int AS count FROM bed b JOIN room r ON b.room_id = r.room_id JOIN floor f ON r.floor_id = f.floor_id `),
            client.query(`SELECT COUNT(*)::int AS count FROM allocation a JOIN bed b ON a.bed_id = b.bed_id JOIN room r ON b.room_id = r.room_id JOIN floor f ON r.floor_id = f.floor_id WHERE a.status = 'active'`)
        ]);

        res.json({
            message: 'Hostel stats fetched successfully',
            floors: floors.rows[0].count,
            rooms: rooms.rows[0].count,
            beds: beds.rows[0].count,
            activeHostelers: hostelers.rows[0].count
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching hostel stats' });
    } 
});

// Stats based on floor_id: rooms, beds, active hostelers
router.get('/floor/:floorId', authMiddleware, async (req, res) => {
    const client = req.dbClient;
    const { floorId } = req.params;

    try {
        const [rooms, beds, hostelers] = await Promise.all([
            client.query('SELECT COUNT(*)::int AS count FROM room WHERE floor_id = $1', [floorId]),
            client.query(`SELECT COUNT(*)::int AS count FROM bed b JOIN room r ON b.room_id = r.room_id WHERE r.floor_id = $1`, [floorId]),
            client.query(`SELECT COUNT(*)::int AS count FROM allocation a JOIN bed b ON a.bed_id = b.bed_id JOIN room r ON b.room_id = r.room_id WHERE r.floor_id = $1 AND a.status = 'active'`, [floorId])
        ]);

        res.json({
            message: 'Floor stats fetched successfully',
            floorId,
            rooms: rooms.rows[0].count,
            beds: beds.rows[0].count,
            activeHostelers: hostelers.rows[0].count
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching floor stats' });
    } finally {
        client.release();
    }
});

// Stats based on room_id: beds, active hostelers
router.get('/room/:roomId', authMiddleware, async (req, res) => {
    const client = req.dbClient;
    const { roomId } = req.params;

    try {
        const [beds, hostelers] = await Promise.all([
            client.query('SELECT COUNT(*)::int AS count FROM bed WHERE room_id = $1', [roomId]),
            client.query(`SELECT COUNT(*)::int AS count FROM allocation a JOIN bed b ON a.bed_id = b.bed_id WHERE b.room_id = $1 AND a.status = 'active'`, [roomId])
        ]);

        res.json({
            message: 'Room stats fetched successfully',
            roomId,
            beds: beds.rows[0].count,
            activeHostelers: hostelers.rows[0].count
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching room stats' });
    } finally {
        client.release();
    }
});

// Based on bed_id: how many people stayed (active + left)
router.get('/bed/:bedId', authMiddleware, async (req, res) => {
    const client = req.dbClient;
    const { bedId } = req.params;

    try {
        const result = await client.query(
            `SELECT a.*, h.first_name, h.last_name, h.phone
             FROM allocation a
             JOIN hosteler h ON a.hosteler_id = h.hosteler_id
             WHERE a.bed_id = $1
             ORDER BY a.check_in_date`,
            [bedId]
        );

        res.json({
            message: 'Bed occupancy history fetched successfully',
            bedId,
            totalStayed: result.rows.length,
            allocations: result.rows.map(toCamel)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching bed stats' });
    } finally {
        client.release();
    }
});

// Based on hosteler_id: bed + room + floor info + payment details
router.get('/hosteler/:hostelerId', authMiddleware, async (req, res) => {
    const client = req.dbClient;
    const { hostelerId } = req.params;

    try {
        const allocationRes = await client.query(
            `SELECT
                a.*,
                b.bed_number,
                r.room_no,
                f.floor_no
             FROM allocation a
             LEFT JOIN bed b ON a.bed_id = b.bed_id
             LEFT JOIN room r ON b.room_id = r.room_id
             LEFT JOIN floor f ON r.floor_id = f.floor_id
             WHERE a.hosteler_id = $1
             ORDER BY a.check_in_date DESC`,
            [hostelerId]
        );

        if (allocationRes.rows.length === 0) {
            return res.status(404).json({ message: 'Hosteler allocation not found' });
        }

        const paymentsRes = await client.query(
            `SELECT p.*, i.invoice_no, i.amount, i.due_date, i.status
             FROM payment p
             JOIN invoice i ON p.invoice_id = i.invoice_id
             WHERE i.hosteler_id = $1
             ORDER BY p.payment_date DESC`,
            [hostelerId]
        );

        res.json({
            message: 'Hosteler details fetched successfully',
            hostelerId,
            allocations: allocationRes.rows.map(toCamel),
            payments: paymentsRes.rows.map(toCamel)
        });

    } catch (err) {
        console.error(err);
        res.status(500).json({ message: 'Error fetching hosteler details' });
    } finally {
        client.release();
    }
});

module.exports = router;
