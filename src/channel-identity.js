'use strict';
const { createHash } = require('node:crypto');

// Keep the complete identity in the digest: punctuation replacement aliases IDs.
function storageToken(scope, channel, accountId) {
  for (const value of [scope, channel, accountId]) {
    if (typeof value !== 'string' || !value || value.length > 512) {
      throw new TypeError('Invalid channel storage identity');
    }
  }
  return createHash('sha256').update(JSON.stringify([scope, channel, accountId])).digest('hex');
}

function accountAllowed(identity, accountId) {
  return Boolean(identity && !identity.demo && typeof accountId === 'string'
    && /^[^\s/\\]{1,128}$/.test(accountId)
    && Array.isArray(identity.accountIds) && identity.accountIds.includes(accountId));
}

module.exports = { storageToken, accountAllowed };
