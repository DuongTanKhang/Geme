import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { contentSecurityPolicy as storefront } from '../outputs/geme/security/csp.ts';
import { contentSecurityPolicy as admin } from '../outputs/geme-admin/lib/csp.ts';

const nonce = '01234567890123456789012345678901';
const production = { NODE_ENV: 'production', NEXT_PUBLIC_API_BASE_URL: '/api/v1', MEDIA_PUBLIC_BASE_URL: 'https://media.example.test' };
test('both app policies stay identical', () => {
  assert.equal(readFileSync(new URL('../outputs/geme/security/csp.ts', import.meta.url), 'utf8'), readFileSync(new URL('../outputs/geme-admin/lib/csp.ts', import.meta.url), 'utf8'));
});
for (const [name, policy] of [['storefront', storefront], ['admin', admin]]) {
  test(`${name}: scripts require a nonce; event handlers and eval are blocked in production`, () => {
    const csp = policy(nonce, production);
    const scripts = csp.split('; ').find(s => s.startsWith('script-src '));
    assert.ok(scripts.includes(`'nonce-${nonce}'`));
    assert.ok(scripts.includes("'strict-dynamic'"));
    assert.ok(!scripts.includes('unsafe-inline')); assert.ok(!scripts.includes('unsafe-eval'));
    assert.ok(csp.includes("script-src-attr 'none'"));
    assert.ok(csp.includes("frame-ancestors 'none'")); assert.ok(csp.includes("object-src 'none'"));
  });
  test(`${name}: public media, Maps, inline styles and API remain usable without permitting arbitrary connections`, () => {
    const csp = policy(nonce, production);
    assert.ok(csp.includes("img-src 'self' https: data: blob:"));
    assert.ok(csp.includes("style-src 'self' 'unsafe-inline'"));
    assert.ok(csp.includes('https://www.google.com'));
    const connections = csp.split('; ').find(s => s.startsWith('connect-src'));
    assert.equal(connections, "connect-src 'self' blob: https://media.example.test");
    assert.ok(!connections.includes('http:'));
  });
  test(`${name}: policy configuration rejects untrusted schemes, embedded credentials and malformed nonces`, () => {
    assert.throws(() => policy("'; script-src *", production));
    for (const origin of ['data:text/plain,x', 'https://user:password@example.test', 'http://example.test'])
      assert.throws(() => policy(nonce, { ...production, CSP_CONNECT_ORIGINS: origin }));
    assert.ok(policy(nonce, { NODE_ENV: 'development' }).includes("'unsafe-eval'"));
  });
}
