const test = require('node:test');
const assert = require('node:assert/strict');
const handler = require('../.test-build/api/subscribe.js').default;

const UPSTREAM_YAML = 'proxies:\n  - name: Node1\n    type: ss\n    server: example.com\n    port: 443\n';
const ENV_KEYS = ['SUBSCRIBE_TOKEN', 'SUBSCRIPTION_URL', 'ALLOW_URL_OVERRIDE', 'REQUIRE_SUBSCRIBE_TOKEN'];

function mockRes() {
 return {
  statusCode: null, body: null, headers: {},
  status(c) { this.statusCode = c; return this; },
  setHeader(k, v) { this.headers[k] = v; },
  send(b) { this.body = b; return this; },
 };
}

// Stubs global fetch, records the URL each request hit, and restores env/ fetch.
async function withUpstream(response, run) {
 const seen = [];
 const realFetch = globalThis.fetch;
 globalThis.fetch = async (url) => {
  seen.push(String(url));
  // A Response body is single-use; hand each call its own clone.
  return response && typeof response.clone === 'function' ? response.clone() : response;
 };
 const saved = {};
 for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
 try { await run(seen); }
 finally {
  globalThis.fetch = realFetch;
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
 }
}

function upstreamOk(body = UPSTREAM_YAML, headers = {}) {
 return new Response(body, { status: 200, headers });
}

test('requests without the configured token are rejected', async () => {
 await withUpstream(upstreamOk(), async () => {
  process.env.SUBSCRIBE_TOKEN = 'secret-token';
  process.env.SUBSCRIPTION_URL = 'https://up.example/sub';
  for (const query of [{}, { token: 'wrong' }, { token: ['wrong', 'secret-token'] }]) {
   const res = mockRes();
   await handler({ query, method: 'GET' }, res);
   assert.equal(res.statusCode, 401, `query ${JSON.stringify(query)} should be rejected`);
   assert.equal(res.headers['Cache-Control'], 'no-store', '401s must not be cached');
  }
  const res = mockRes();
  await handler({ query: { token: 'secret-token' }, method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
 });
});

test('serves rewritten config and passes through subscription-userinfo', async () => {
 await withUpstream(upstreamOk(UPSTREAM_YAML, { 'subscription-userinfo': 'upload=1; total=2' }), async () => {
  process.env.SUBSCRIBE_TOKEN = 'secret-token';
  process.env.SUBSCRIPTION_URL = 'https://up.example/sub';
  const res = mockRes();
  await handler({ query: { token: 'secret-token' }, method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/yaml/);
  assert.match(res.headers['Cache-Control'], /s-maxage=60/, 'success responses are CDN-cacheable');
  assert.equal(res.headers['subscription-userinfo'], 'upload=1; total=2');
  assert.match(res.body, /proxy-groups:/);
  assert.match(res.body, /Node1/);
 });
});

test('upstream failures return generic 502 bodies without upstream detail', async () => {
 for (const response of [
  new Response('secret: [leaked-content', { status: 200 }),
  new Response('n/a', { status: 500 }),
  new Response('proxies: []\n', { status: 200 }),
 ]) {
  await withUpstream(response, async () => {
   process.env.SUBSCRIBE_TOKEN = 'secret-token';
   process.env.SUBSCRIPTION_URL = 'https://up.example/sub';
   const res = mockRes();
   await handler({ query: { token: 'secret-token' }, method: 'GET' }, res);
   assert.equal(res.statusCode, 502);
   assert.ok(!res.body.includes('leaked-content'), 'body must not quote upstream content');
   assert.ok(!res.body.includes('up.example'), 'body must not name the upstream URL');
  });
 }
 await withUpstream(Promise.reject(new Error('fetch to https://up.example/sub?cred=x failed')), async () => {
  process.env.SUBSCRIBE_TOKEN = 'secret-token';
  process.env.SUBSCRIPTION_URL = 'https://up.example/sub?cred=x';
  const res = mockRes();
  await handler({ query: { token: 'secret-token' }, method: 'GET' }, res);
  assert.equal(res.statusCode, 502);
  assert.ok(!res.body.includes('cred=x'), 'body must not leak the subscription URL');
 });
});

test('?url= overrides SUBSCRIPTION_URL only when ALLOW_URL_OVERRIDE=1', async () => {
 await withUpstream(upstreamOk(), async (seen) => {
  process.env.SUBSCRIBE_TOKEN = 'secret-token';
  process.env.SUBSCRIPTION_URL = 'https://up.example/configured';
  process.env.ALLOW_URL_OVERRIDE = '1';
  let res = mockRes();
  await handler({ query: { token: 'secret-token', url: 'https://alt.example/other' }, method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.at(-1), 'https://alt.example/other');

  process.env.ALLOW_URL_OVERRIDE = '0';
  res = mockRes();
  await handler({ query: { token: 'secret-token', url: 'https://alt.example/other' }, method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(seen.at(-1), 'https://up.example/configured');
 });
});

test('REQUIRE_SUBSCRIBE_TOKEN fails closed on a missing token without breaking the default', async () => {
 await withUpstream(upstreamOk(), async (seen) => {
  process.env.REQUIRE_SUBSCRIBE_TOKEN = '1';
  const res = mockRes();
  await handler({ query: { token: 'anything' }, method: 'GET' }, res);
  assert.equal(res.statusCode, 503);
  assert.equal(seen.length, 0, 'upstream must not be fetched');

  delete process.env.REQUIRE_SUBSCRIBE_TOKEN;
  process.env.SUBSCRIPTION_URL = 'https://up.example/sub';
  const open = mockRes();
  await handler({ query: {}, method: 'GET' }, open);
  assert.equal(open.statusCode, 200, 'default stays open when no token is configured');
 });
});

test('oversized upstream responses are refused before parsing', async () => {
 await withUpstream(new Response(UPSTREAM_YAML, { status: 200, headers: { 'content-length': '999999999' } }), async () => {
  process.env.SUBSCRIBE_TOKEN = 'secret-token';
  process.env.SUBSCRIPTION_URL = 'https://up.example/sub';
  const res = mockRes();
  await handler({ query: { token: 'secret-token' }, method: 'GET' }, res);
  assert.equal(res.statusCode, 502);
  assert.ok(!res.body.includes('Node1'), 'oversized body must not be parsed');
 });
});

test('only GET and HEAD are served', async () => {
 await withUpstream(upstreamOk(), async (seen) => {
  process.env.SUBSCRIBE_TOKEN = 'secret-token';
  process.env.SUBSCRIPTION_URL = 'https://up.example/sub';
  const res = mockRes();
  await handler({ query: { token: 'secret-token' }, method: 'POST' }, res);
  assert.equal(res.statusCode, 405);
  assert.equal(res.headers['Allow'], 'GET, HEAD');
  assert.equal(seen.length, 0, 'rejected methods must not fetch upstream');
  const head = mockRes();
  await handler({ query: { token: 'secret-token' }, method: 'HEAD' }, head);
  assert.equal(head.statusCode, 200);
 });
});

test('non-http ?url= values are rejected when the override is enabled', async () => {
 await withUpstream(upstreamOk(), async (seen) => {
  process.env.ALLOW_URL_OVERRIDE = '1';
  for (const url of ['file:///etc/passwd', 'not-a-url']) {
   const res = mockRes();
   await handler({ query: { url }, method: 'GET' }, res);
   assert.equal(res.statusCode, 400, `${url} must be rejected`);
  }
  assert.equal(seen.length, 0, 'rejected URLs must not be fetched');
 });
});

test('YAML parse errors report a line/column position', async () => {
 await withUpstream(new Response('a: [1\nb: 2', { status: 200 }), async () => {
  process.env.SUBSCRIBE_TOKEN = 'secret-token';
  process.env.SUBSCRIPTION_URL = 'https://up.example/sub';
  const res = mockRes();
  await handler({ query: { token: 'secret-token' }, method: 'GET' }, res);
  assert.equal(res.statusCode, 502);
  assert.match(res.body, /line \d+, column \d+/);
 });
});

test('flag-like env vars accept only 0/1 and junk values fail closed', async () => {
 await withUpstream(upstreamOk(), async (seen) => {
  for (const [key, value] of [['REQUIRE_SUBSCRIBE_TOKEN', 'true'], ['ALLOW_URL_OVERRIDE', 'yes']]) {
   process.env[key] = value;
   const res = mockRes();
   await handler({ query: { token: 'anything' }, method: 'GET' }, res);
   assert.equal(res.statusCode, 503, `${key}=${value} must be refused`);
   delete process.env[key];
  }
  assert.equal(seen.length, 0, 'misconfigured flags must not fetch upstream');
 });
});

test('operator configuration errors surface as 500, not upstream 502', async () => {
 await withUpstream(upstreamOk(), async () => {
  process.env.SUBSCRIBE_TOKEN = 'secret-token';
  process.env.SUBSCRIPTION_URL = 'https://up.example/sub';
  Object.assign(process.env, { RELAY_HOST: '203.0.113.10', RELAY_USERNAME: 'u', RELAY_PASSWORD: 'p', RELAY_PORT: 'abc' });
  try {
   const res = mockRes();
   await handler({ query: { token: 'secret-token' }, method: 'GET' }, res);
   assert.equal(res.statusCode, 500);
  } finally {
   for (const key of ['RELAY_HOST', 'RELAY_USERNAME', 'RELAY_PASSWORD', 'RELAY_PORT']) delete process.env[key];
  }
 });
});

test('a non-http SUBSCRIPTION_URL is an operator error, not upstream trouble', async () => {
 await withUpstream(upstreamOk(), async (seen) => {
  for (const url of ['file:///etc/passwd', 'not-a-url']) {
   process.env.SUBSCRIPTION_URL = url;
   const res = mockRes();
   await handler({ query: {}, method: 'GET' }, res);
   assert.equal(res.statusCode, 500, `${url} must be an operator error`);
  }
  assert.equal(seen.length, 0, 'invalid configured URLs must not be fetched');
 });
});

test('partially configured relay is an operator error, not silent omission', async () => {
 await withUpstream(upstreamOk(), async () => {
  process.env.SUBSCRIBE_TOKEN = 'secret-token';
  process.env.SUBSCRIPTION_URL = 'https://up.example/sub';
  process.env.RELAY_HOST = '203.0.113.10';
  process.env.RELAY_USERNAME = 'u';
  try {
   const res = mockRes();
   await handler({ query: { token: 'secret-token' }, method: 'GET' }, res);
   assert.equal(res.statusCode, 500);
  } finally {
   delete process.env.RELAY_HOST;
   delete process.env.RELAY_USERNAME;
  }
 });
});

test('malformed upstream passthrough headers are dropped, not fatal', async () => {
 const bad = 'upload=1; total=' + String.fromCharCode(7) + '2'; // control byte Node's setHeader rejects
 const fake = {
  ok: true,
  status: 200,
  headers: { get: (name) => name === 'subscription-userinfo' ? bad : null },
  text: async () => UPSTREAM_YAML,
 };
 await withUpstream(fake, async () => {
  process.env.SUBSCRIBE_TOKEN = 'secret-token';
  process.env.SUBSCRIPTION_URL = 'https://up.example/sub';
  const res = mockRes();
  await handler({ query: { token: 'secret-token' }, method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /proxy-groups:/);
  assert.equal(res.headers['subscription-userinfo'], undefined);
 });
});
