'use strict';

const crypto = require('crypto');

/** Generates a new project key. Only its hash is ever stored. */
function generateApiKey() {
  return `pk_${crypto.randomBytes(24).toString('base64url')}`;
}

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

module.exports = { generateApiKey, hashApiKey };
