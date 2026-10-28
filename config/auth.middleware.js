// auth.middleware.js
const jwt = require('jsonwebtoken');
const { getClient, runWithClient } = require('./database');

const SAFE_SCHEMA = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

module.exports = async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (!token || !/^Bearer$/i.test(scheme)) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  if (typeof token !== 'string' || token.trim().length === 0) {
    return res.status(401).json({ message: 'Authentication required' });
  }

  let client;

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || !decoded.userId || !decoded.hostelId) {
      return res.status(401).json({ message: 'Invalid session token' });
    }

    const schemaName = decoded.schema || 'public';
    if (!SAFE_SCHEMA.test(schemaName)) {
      return res.status(401).json({ message: 'Invalid schema in token' });
    }

    client = await getClient();

    // Guard against double-release. Routes also call release() in `finally`,
    // and the response lifecycle releases once more.
    const origRelease = client.release.bind(client);
    let released = false;
    client.release = (cb) => {
      if (released) {
        if (typeof cb === 'function') cb();
        return;
      }
      released = true;
      return origRelease(cb);
    };

    await client.query(`SET search_path TO "${schemaName}", public`);

    res.on('finish', () => client.release());
    res.on('close', () => client.release());

    req.dbClient = client;
    req.user = decoded;

    // Every query() executed further down this request automatically uses the
    // tenant-scoped client, even when a route does not read req.dbClient.
    runWithClient(client, () => next());
  } catch (err) {
    if (client) {
      try {
        client.release();
      } catch (e) {
        // ignore
      }
    }

    return res.status(401).json({ message: 'Invalid or expired session' });
  }
};
