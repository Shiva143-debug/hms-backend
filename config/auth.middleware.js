// auth.middleware.js
const jwt = require('jsonwebtoken');
const { getClient } = require('./database');

module.exports = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: 'No token' });

  const token = header.split(' ')[1];

  let client;
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    client = await getClient();

    const schemaName = decoded.schema;
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schemaName)) {
      client.release();
      return res.status(401).json({ message: 'Invalid schema in token' });
    }
    await client.query(`SET search_path TO ${schemaName}, public`);

    // Guard against double-release and guarantee the client is returned to the
    // pool even when a route forgets to release it.
    const origRelease = client.release.bind(client);
    client.release = (done) => {
      if (client._released) return done && done(new Error('Client already released'));
      client._released = true;
      return origRelease(done);
    };
    res.on('finish', () => client.release());
    res.on('close', () => client.release());

    req.dbClient = client;
    req.user = decoded;

    next();
  } catch (err) {
    if (client && !client._released) {
      try {
        client.release();
      } catch (e) {
        // ignore
      }
    }
    res.status(401).json({ message: 'Invalid token' });
  }
};