const express = require('express');
const authMiddleware = require('../config/auth.middleware');
const toCamel = require('../utils').toCamel;

const router = express.Router();

// Generate an invoice for a hosteler based on their active stay / room rent.
// invoice table: invoice_id, hosteler_id, invoice_no, amount, due_date, status
router.post('/generate-invoice', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { hostelerId, amount, dueDate } = req.body;

  try {
    const allocRes = await client.query(
      `SELECT a.allocation_id, r.price_monthly, r.price_daily, r.room_no, b.bed_number
       FROM allocation a
       JOIN bed b ON a.bed_id = b.bed_id
       JOIN room r ON b.room_id = r.room_id
       WHERE a.hosteler_id = $1 AND a.status = 'active'
       ORDER BY a.check_in_date DESC
       LIMIT 1`,
      [hostelerId]
    );

    if (allocRes.rowCount === 0) {
      return res.status(404).json({ message: 'No active stay found for hosteler' });
    }

    const monthlyRent = parseFloat(allocRes.rows[0].price_monthly) || 0;
    const invoiceNo = 'INV-' + Date.now();

    const due = dueDate
      ? new Date(dueDate)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    const invoiceRes = await client.query(
      `INSERT INTO invoice (hosteler_id, invoice_no, amount, due_date, status)
       VALUES ($1, $2, $3, $4, 'pending')
       RETURNING *`,
      [hostelerId, invoiceNo, amount || monthlyRent, due]
    );

    res.status(201).json({
      message: 'Invoice generated',
      invoice: toCamel(invoiceRes.rows[0]),
      room: allocRes.rows[0].room_no,
      bed: allocRes.rows[0].bed_number
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error generating invoice' });
  } finally {
    client.release();
  }
});

// All invoices with hosteler + room + bed + amount paid + status
router.get('/get-invoices', authMiddleware, async (req, res) => {
  const client = req.dbClient;

  try {
    const result = await client.query(
      `SELECT
         i.invoice_id, i.invoice_no, i.amount, i.due_date, i.status,
         h.hosteler_id, h.first_name, h.last_name, h.phone,
         b.bed_number, r.room_no, f.floor_no,
         COALESCE(SUM(p.amount), 0)::numeric AS amount_paid
       FROM invoice i
       LEFT JOIN hosteler h ON i.hosteler_id = h.hosteler_id
       LEFT JOIN allocation a ON a.hosteler_id = h.hosteler_id AND a.status = 'active'
       LEFT JOIN bed b ON a.bed_id = b.bed_id
       LEFT JOIN room r ON b.room_id = r.room_id
       LEFT JOIN floor f ON r.floor_id = f.floor_id
       LEFT JOIN payment p ON p.invoice_id = i.invoice_id
       GROUP BY i.invoice_id, i.invoice_no, i.amount, i.due_date, i.status,
                h.hosteler_id, h.first_name, h.last_name, h.phone,
                b.bed_number, r.room_no, f.floor_no
       ORDER BY i.due_date DESC`
    );

    res.json({
      message: 'Invoices fetched successfully',
      invoices: result.rows.map(toCamel)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching invoices' });
  } finally {
    client.release();
  }
});

// Overdue invoices (due date passed, not fully paid)
router.get('/due-invoices', authMiddleware, async (req, res) => {
  const client = req.dbClient;

  try {
    const result = await client.query(
      `SELECT
         i.invoice_id, i.invoice_no, i.amount, i.due_date, i.status,
         h.hosteler_id, h.first_name, h.last_name, h.phone,
         b.bed_number, r.room_no, f.floor_no
       FROM invoice i
       JOIN hosteler h ON i.hosteler_id = h.hosteler_id
       LEFT JOIN allocation a ON a.hosteler_id = h.hosteler_id AND a.status = 'active'
       LEFT JOIN bed b ON a.bed_id = b.bed_id
       LEFT JOIN room r ON b.room_id = r.room_id
       LEFT JOIN floor f ON r.floor_id = f.floor_id
       WHERE i.status <> 'paid' AND i.due_date < CURRENT_DATE
       ORDER BY i.due_date ASC`
    );

    res.json({
      message: 'Due invoices fetched',
      dueList: result.rows.map(toCamel)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching due invoices' });
  } finally {
    client.release();
  }
});

// Invoices due within the next day OR already overdue (for notifications)
router.get('/upcoming-due', authMiddleware, async (req, res) => {
  const client = req.dbClient;

  try {
    const result = await client.query(
      `SELECT
         i.invoice_id, i.invoice_no, i.amount, i.due_date, i.status,
         h.hosteler_id, h.first_name, h.last_name, h.phone,
         r.room_no, b.bed_number
       FROM invoice i
       JOIN hosteler h ON i.hosteler_id = h.hosteler_id
       LEFT JOIN allocation a ON a.hosteler_id = h.hosteler_id AND a.status = 'active'
       LEFT JOIN bed b ON a.bed_id = b.bed_id
       LEFT JOIN room r ON b.room_id = r.room_id
       WHERE i.status <> 'paid'
         AND i.due_date BETWEEN (CURRENT_DATE - 1) AND (CURRENT_DATE + 1)
       ORDER BY i.due_date ASC`
    );

    res.json({
      message: 'Upcoming / due invoices fetched',
      alerts: result.rows.map(toCamel)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching upcoming dues' });
  } finally {
    client.release();
  }
});

// Payment history for a hosteler with their invoices
router.get('/hosteler/:hostelerId/invoices', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { hostelerId } = req.params;

  try {
    const invoices = await client.query(
      `SELECT * FROM invoice WHERE hosteler_id = $1 ORDER BY due_date DESC`,
      [hostelerId]
    );

    const payments = await client.query(
      `SELECT p.*
       FROM payment p
       JOIN invoice i ON p.invoice_id = i.invoice_id
       WHERE i.hosteler_id = $1
       ORDER BY p.payment_date DESC`,
      [hostelerId]
    );

    res.json({
      message: 'Hosteler payments fetched successfully',
      hostelerId,
      invoices: invoices.rows.map(toCamel),
      payments: payments.rows.map(toCamel)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching hosteler payments' });
  } finally {
    client.release();
  }
});

// Record a payment against an invoice
router.post('/payment', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { invoiceId, amount, mode, reference } = req.body;

  try {
    if (!invoiceId || !amount) {
      return res.status(400).json({ message: 'invoiceId and amount are required' });
    }

    await client.query(
      'INSERT INTO payment (invoice_id, amount, mode, reference_no) VALUES ($1, $2, $3, $4)',
      [invoiceId, amount, mode || 'cash', reference || null]
    );

    const sumRes = await client.query(
      'SELECT COALESCE(SUM(amount), 0)::numeric AS paid FROM payment WHERE invoice_id = $1',
      [invoiceId]
    );

    const paid = parseFloat(sumRes.rows[0].paid);

    const invoiceRes = await client.query(
      'SELECT amount FROM invoice WHERE invoice_id = $1',
      [invoiceId]
    );

    if (invoiceRes.rowCount === 0) {
      return res.status(404).json({ message: 'Invoice not found' });
    }

    const total = parseFloat(invoiceRes.rows[0].amount);
    let status = 'pending';
    if (paid >= total) status = 'paid';
    else if (paid > 0) status = 'partial';

    await client.query(
      "UPDATE invoice SET status = $1 WHERE invoice_id = $2",
      [status, invoiceId]
    );

    res.json({ message: 'Payment recorded', status, paid, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Payment failed' });
  } finally {
    client.release();
  }
});

module.exports = router;