const express = require('express');
const nodemailer = require('nodemailer');
const authMiddleware = require('../config/auth.middleware');
const toCamel = require('../utils').toCamel;
const { query } = require('../config/database');

const router = express.Router();

async function ensureTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS public.notification (
      notification_id BIGSERIAL PRIMARY KEY,
      hosteler_id     BIGINT,
      phone           VARCHAR(20),
      email           VARCHAR(255),
      channel         VARCHAR(20),
      subject         TEXT,
      body            TEXT,
      status          VARCHAR(20) DEFAULT 'sent',
      error           TEXT,
      sent_at         TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

ensureTable().catch((err) => console.error('Notification table init error:', err.message));

// Transport configured from .env mail credentials (Gmail app password).
function buildTransport() {
  return nodemailer.createTransport({
    host: process.env.EMAIL_HOST || 'smtp.gmail.com',
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.MAIL_USER,
      pass: process.env.MAIL_PASS,
    },
  });
}

function sendEmail(to, subject, text) {
  const from = `"StayMate Hostel" <${process.env.MAIL_USER}>`;
  return buildTransport().sendMail({ from, to, subject, text });
}

// List of sent notifications
router.get('/notifications', authMiddleware, async (req, res) => {
  const client = req.dbClient;

  try {
    const result = await client.query(
      `SELECT n.*, h.first_name, h.last_name
       FROM notification n
       LEFT JOIN hosteler h ON n.hosteler_id = h.hosteler_id
       ORDER BY n.sent_at DESC
       LIMIT 50`
    );

    res.json({
      message: 'Notifications fetched successfully',
      notifications: result.rows.map(toCamel)
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error fetching notifications' });
  } finally {
    client.release();
  }
});

// Manual trigger: notify every hosteler with a pending / overdue payment.
// Sends email if the hosteler has one; otherwise falls back to numeric channel
// (SMS requires Twilio credentials — logs 'sms' with error when unconfigured).
router.post('/send-reminders', authMiddleware, async (req, res) => {
  const client = req.dbClient;
  const { overdueOnly } = req.body || {};

  try {
    const dueCondition = overdueOnly
      ? `i.due_date < CURRENT_DATE`
      : `i.due_date <= (CURRENT_DATE + 1)`;

    const pending = await client.query(
      `SELECT
         i.invoice_id, i.invoice_no, i.due_date,
         h.hosteler_id, h.first_name, h.last_name, h.phone, h.email,
         r.room_no, b.bed_number,
         (i.amount - COALESCE(SUM(p.amount), 0))::numeric AS amount_due
       FROM invoice i
       JOIN hosteler h ON i.hosteler_id = h.hosteler_id
       LEFT JOIN allocation a ON a.hosteler_id = h.hosteler_id AND a.status = 'active'
       LEFT JOIN bed b ON a.bed_id = b.bed_id
       LEFT JOIN room r ON b.room_id = r.room_id
       LEFT JOIN payment p ON p.invoice_id = i.invoice_id
       WHERE i.status <> 'paid' AND ${dueCondition}
       GROUP BY i.invoice_id, i.invoice_no, i.due_date,
                h.hosteler_id, h.first_name, h.last_name, h.phone, h.email,
                r.room_no, b.bed_number, i.amount
       HAVING i.amount - COALESCE(SUM(p.amount), 0) > 0
       ORDER BY h.first_name, i.due_date`
    );

    if (pending.rowCount === 0) {
      return res.json({ message: 'No pending payments to remind', sent: 0, results: [] });
    }

    const results = [];

    for (const row of pending.rows) {
      const hostelerId = row.hosteler_id;
      const dueLeft = Math.round(
        (new Date(row.due_date) - new Date()) / (24 * 60 * 60 * 1000)
      );
      const text = [
        `Dear ${row.first_name} ${row.last_name || ''},`,
        '',
        `This is a friendly reminder that your hostel rent of ₹${Number(row.amount_due).toFixed(2)} ` +
          `(Room ${row.room_no || '—'}, Bed ${row.bed_number || '—'}) is ${
            dueLeft < 0 ? `${Math.abs(dueLeft)} day(s) overdue` : `due in ${dueLeft} day(s)`
          }.`,
        '',
        'Please clear your dues at the earliest. Thank you!',
        '— Your Hostel Team',
      ].join('\n');

      if (row.email) {
        try {
          await sendEmail(
            row.email,
            `Rent reminder • ${row.invoice_no}`,
            text
          );
          await client.query(
            `INSERT INTO notification (hosteler_id, phone, email, channel, subject, body, status)
             VALUES ($1, $2, $3, 'email', $4, $5, 'sent')`,
            [hostelerId, row.phone, row.email, 'Rent Reminder', text]
          );
          results.push({ hostelerId, name: `${row.first_name} ${row.last_name || ''}`, channel: 'email', status: 'sent' });
        } catch (err) {
          const error = err.message;
          await client.query(
            `INSERT INTO notification (hosteler_id, phone, email, channel, subject, body, status, error)
             VALUES ($1, $2, $3, 'email', $4, $5, 'failed', $6)`,
            [hostelerId, row.phone, row.email, 'Rent Reminder', text, error]
          );
          results.push({ hostelerId, name: `${row.first_name} ${row.last_name || ''}`, channel: 'email', status: 'failed', error });
        }
      } else {
        // No email — SMS requires Twilio creds; log an sms attempt as fallback.
        const error = 'No email on file; SMS requires Twilio credentials';
        await client.query(
          `INSERT INTO notification (hosteler_id, phone, email, channel, subject, body, status, error)
           VALUES ($1, $2, NULL, 'sms', $3, $4, 'failed', $5)`,
          [hostelerId, row.phone, 'Rent Reminder', text, error]
        );
        results.push({ hostelerId, name: `${row.first_name} ${row.last_name || ''}`, channel: 'sms', status: 'failed', error });
      }
    }

    res.json({
      message: 'Reminders processed',
      sent: results.filter((r) => r.status === 'sent').length,
      results
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Error sending reminders' });
  } finally {
    client.release();
  }
});

module.exports = router;