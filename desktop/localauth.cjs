// Single-user sign-in for the desktop app. The per-install secret (<data>/secret.key, made by the server, 0600)
// derives the owner key the server already accepts from this machine only (POST /api/auth/owner). We ask it for
// a one-time sign-in link and open that: the sign-in page is never shown, and the server's routes are unchanged.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const EMAIL = 'me@localhost';

/** A one-time URL that signs the opening browser in as the local user, then redirects to the app. */
async function signInUrl(dataDir, baseUrl) {
  const secret = fs.readFileSync(path.join(dataDir, 'secret.key'), 'utf8').trim();
  const key = crypto.createHmac('sha256', secret).update('owner-login').digest('hex');
  const r = await fetch(`${baseUrl}/api/auth/owner`, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, name: 'Me', link: true }),
  });
  if (!r.ok) throw new Error(`local sign-in refused: HTTP ${r.status}`);
  return (await r.json()).url;
}

module.exports = { signInUrl, EMAIL };
