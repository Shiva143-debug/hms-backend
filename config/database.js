const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  keepAlive: true,
  statement_timeout: 20000,
  query_timeout: 25000,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client:', err);
});

pool.connect()
  .then(() => console.log('Connected to database.'))
  .catch((err) => console.error('Error connecting to database:', err.message));

async function getClient() {
  const client = await pool.connect();
  // Swallow transient idle/connection errors on checked-out clients so an
  // unhandled 'error' event never crashes the whole server.
  client.on('error', (err) => {
    console.error('Idle client error:', err.message);
  });
  return client;
}

module.exports = { pool, query: pool.query.bind(pool), getClient };
