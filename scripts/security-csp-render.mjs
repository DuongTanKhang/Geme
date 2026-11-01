// Run against an isolated `next start` using the security build, never a live account action.
import assert from 'node:assert/strict';
const target = process.argv[2];
if (!target || !['127.0.0.1', 'localhost'].includes(new URL(target).hostname)) throw new Error('Supply a local test-page URL');
let previous;
for (let attempt = 0; attempt < 2; attempt++) {
  const reply = await fetch(target, { headers: { 'x-nonce': 'attacker-selected', 'Content-Security-Policy': "script-src * 'unsafe-inline'" } });
  assert.equal(reply.status, 200);
  const csp = reply.headers.get('content-security-policy') || '';
  const nonce = csp.match(/'nonce-([^']+)'/)?.[1];
  assert.ok(nonce && nonce !== 'attacker-selected' && nonce !== previous);
  assert.match(reply.headers.get('cache-control') || '', /no-store/);
  assert.equal(reply.headers.get('cdn-cache-control'), 'no-store');
  const html = await reply.text();
  const scripts = [...html.matchAll(/<script\b([^>]*)>/g)];
  assert.ok(scripts.length > 0);
  for (const [, attributes] of scripts) assert.ok(attributes.includes(`nonce="${nonce}"`), 'Every rendered script, including JSON-LD, must carry this response nonce');
  previous = nonce;
}
console.log('PASS: rendered scripts match fresh CSP nonces; spoofed headers ignored; HTML is not publicly cached.');
