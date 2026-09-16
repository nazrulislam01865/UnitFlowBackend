const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { generateKeyPairSync, sign, verify } = require('node:crypto');
// Resolve the actual transitive module used by Firebase, including nested installations.
require('firebase-admin/auth');
const fromFirebase = createRequire(require.resolve('firebase-admin/auth'));
const jwks = fromFirebase('jwks-rsa');
async function main() {
  for (const [kind, options, alg] of [
    ['rsa', { modulusLength: 2048 }, 'RS256'],
    ['ec', { namedCurve: 'P-256' }, 'ES256'],
  ]) {
    const { publicKey, privateKey } = generateKeyPairSync(kind, options);
    const key = { ...publicKey.export({ format: 'jwk' }), kid: kind, use: 'sig', alg };
    const client = jwks({
      jwksUri: 'https://unused.invalid/jwks',
      cache: false,
      fetcher: async () => ({ keys: [key] }),
    });
    const signingKeys = await client.getSigningKeys();
    assert.equal(signingKeys.length, 1);
    const bytes = Buffer.from('UnitFlow runtime regression');
    const signature = sign('sha256', bytes, privateKey);
    assert.equal(verify('sha256', bytes, signingKeys[0].getPublicKey(), signature), true);
    assert.equal(
      verify('sha256', Buffer.from('tampered'), signingKeys[0].getPublicKey(), signature),
      false,
    );
    await assert.rejects(client.getSigningKey('unknown-key'));
  }
  console.log('CommonJS Firebase/JWKS smoke passed');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
