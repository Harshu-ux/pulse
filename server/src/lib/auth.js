'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const BCRYPT_ROUNDS = 10;
// Compared against when the email doesn't exist, so a failed login takes the
// same time either way and can't be used to discover which emails are registered.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', BCRYPT_ROUNDS);

const hashPassword = (password) => bcrypt.hash(password, BCRYPT_ROUNDS);

async function checkPassword(password, hash) {
  return bcrypt.compare(password, hash || DUMMY_HASH).then((ok) => ok && Boolean(hash));
}

function signToken(user, { jwtSecret, jwtExpiresIn }) {
  return jwt.sign({ sub: String(user._id || user.id), email: user.email, name: user.name }, jwtSecret, {
    expiresIn: jwtExpiresIn,
  });
}

/** Returns { id, email, name } or null if the token is missing, invalid or expired. */
function verifyToken(token, { jwtSecret }) {
  if (!token) return null;
  try {
    const p = jwt.verify(token, jwtSecret);
    return { id: p.sub, email: p.email, name: p.name };
  } catch {
    return null;
  }
}

module.exports = { hashPassword, checkPassword, signToken, verifyToken };
