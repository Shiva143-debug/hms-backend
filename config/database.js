const { Pool } = require('pg');
const { AsyncLocalStorage } = require('async_hooks');
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

// Attach one error listener per pooled client instead of on every checkout.
pool.on('connect', (client) => {
  client.on('error', (err) => {
    console.error('Idle client error:', err.message);
  });
});

pool.connect()
  .then(() => console.log('Connected to database.'))
  .catch((err) => console.error('Error connecting to database:', err.message));

// AsyncLocalStorage keeps the request's tenant-scoped client attached to every
// async call. `query()` therefore automatically runs on the connection whose
// search_path was set by the auth middleware, even in routes that do not have
// access to `req`.
const tenantContext = new AsyncLocalStorage();

async function getClient() {
  return pool.connect();
}

function query(text, params) {
  const store = tenantContext.getStore();
  const runner = store && store.client ? store.client : pool;
  return runner.query(text, params);
}

function runWithClient(client, fn) {
  return tenantContext.run({ client }, fn);
}

module.exports = {
  pool,
  query,
  getClient,
  runWithClient,
};
