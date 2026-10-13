const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
	mintEphemeralCredentials,
	verifyEphemeralCredentials,
	buildSubscriptionUrl,
	DEFAULT_LINK_TTL_SECONDS,
} = require("../.test-build/api/ephemeral-link.js");
const { readConfiguredPin, writePin, validatePin } = require("../.test-build/api/pin-store.js");
const { resetAttempts } = require("../.test-build/api/attempt-limit.js");
const issue = require("../.test-build/api/portal/issue.js").default;
const auth = require("../.test-build/api/portal/auth.js").default;
const changePin = require("../.test-build/api/portal/pin.js").default;
const { handleEphemeral } = require("../.test-build/api/ephemeral.js");
const subscribe = require("../.test-build/api/subscribe.js").default;

const ENV_KEYS = [
	"PIN_FILE",
	"PORTAL_PIN",
	"ADMIN_PASSWORD",
	"LINK_SECRET",
	"SUBSCRIBE_TOKEN",
	"PUBLIC_ORIGIN",
	"LINK_TTL_SECONDS",
	"SUBSCRIPTION_URL",
	"ALLOW_URL_OVERRIDE",
];

function mockRes() {
	return {
		statusCode: 200,
		body: undefined,
		headers: {},
		status(code) {
			this.statusCode = code;
			return this;
		},
		setHeader(name, value) {
			this.headers[name.toLowerCase()] = value;
			return this;
		},
		send(body) {
			this.body = body;
			return this;
		},
	};
}

function parsed(res) {
	return typeof res.body === "string" ? JSON.parse(res.body) : res.body;
}

async function call(handler, { method = "POST", body = {}, headers = {}, query = {} } = {}) {
	const res = mockRes();
	await handler({ method, body, headers, query }, res);
	return res;
}

test.describe("subscription portal", { concurrency: false }, () => {
	/** @type {Record<string, string | undefined>} */
	let snapshot;
	/** @type {string} */
	let dir;

	test.beforeEach(() => {
		snapshot = {};
		for (const key of ENV_KEYS) snapshot[key] = process.env[key];
		dir = fs.mkdtempSync(path.join(os.tmpdir(), "portal-"));
		process.env.PIN_FILE = path.join(dir, "pin.txt");
		delete process.env.PORTAL_PIN;
		process.env.ADMIN_PASSWORD = "admin-secret";
		process.env.LINK_SECRET = "link-secret";
		delete process.env.SUBSCRIBE_TOKEN;
		process.env.PUBLIC_ORIGIN = "https://sub.example";
		delete process.env.LINK_TTL_SECONDS;
		delete process.env.SUBSCRIPTION_URL;
		delete process.env.ALLOW_URL_OVERRIDE;
		resetAttempts();
	});

	test.afterEach(() => {
		for (const key of ENV_KEYS) {
			if (snapshot[key] === undefined) delete process.env[key];
			else process.env[key] = snapshot[key];
		}
		fs.rmSync(dir, { recursive: true, force: true });
	});

	test("each generated link uses a new random path and key", () => {
		const now = 1_700_000_000_000;
		const first = buildSubscriptionUrl("https://sub.example", "link-secret", now, DEFAULT_LINK_TTL_SECONDS);
		const second = buildSubscriptionUrl("https://sub.example", "link-secret", now, DEFAULT_LINK_TTL_SECONDS);
		assert.notEqual(first.url, second.url);
		assert.match(first.url, /^https:\/\/sub\.example\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/);
		const [, token, key] = new URL(first.url).pathname.split("/");
		assert.ok(token.length >= 20);
		assert.ok(key.length >= 20);
		assert.equal(verifyEphemeralCredentials("link-secret", token, key, now, DEFAULT_LINK_TTL_SECONDS), true);
	});

	test("a link stops working five minutes after it is created", () => {
		const now = 1_700_000_000_000;
		const minted = mintEphemeralCredentials("link-secret", now, 300);
		assert.equal(verifyEphemeralCredentials("link-secret", minted.token, minted.key, now + 299_000, 300), true);
		assert.equal(verifyEphemeralCredentials("link-secret", minted.token, minted.key, now + 300_000, 300), false);
	});

	test("a link is rejected when the key, path, or signing secret does not match", () => {
		const now = 1_700_000_000_000;
		const minted = mintEphemeralCredentials("link-secret", now, 300);
		const other = mintEphemeralCredentials("link-secret", now, 300);
		assert.equal(verifyEphemeralCredentials("link-secret", minted.token, other.key, now, 300), false);
		assert.equal(verifyEphemeralCredentials("other-secret", minted.token, minted.key, now, 300), false);
		assert.equal(verifyEphemeralCredentials("link-secret", `${minted.token}x`, minted.key, now, 300), false);
		assert.equal(verifyEphemeralCredentials("link-secret", minted.token, minted.key.slice(0, -1), now, 300), false);
	});

	test("extending the expiry embedded in the path invalidates the link", () => {
		const now = 1_700_000_000_000;
		const minted = mintEphemeralCredentials("link-secret", now, 300);
		const raw = Buffer.from(minted.token.replace(/-/g, "+").replace(/_/g, "/"), "base64");
		raw.writeUInt32BE(raw.readUInt32BE(0) + 3600, 0);
		const extended = raw
			.toString("base64")
			.replace(/\+/g, "-")
			.replace(/\//g, "_")
			.replace(/=+$/g, "");
		assert.equal(verifyEphemeralCredentials("link-secret", extended, minted.key, now, 300), false);
	});

	test("the PIN file overrides PORTAL_PIN and round-trips what was written", () => {
		process.env.PORTAL_PIN = "fromenv";
		assert.equal(readConfiguredPin(), "fromenv");
		writePin("filepin");
		assert.equal(readConfiguredPin(), "filepin");
		assert.equal(fs.readFileSync(process.env.PIN_FILE, "utf8").trim(), "filepin");
		assert.equal(validatePin("12"), "PIN must be 4–64 letters or digits");
		assert.equal(validatePin("goodPIN1"), null);
	});

	test("the correct PIN returns one short-lived subscription URL", async () => {
		writePin("246810");
		const res = await call(issue, {
			body: { pin: "246810" },
			headers: { "x-forwarded-for": "203.0.113.10" },
		});
		assert.equal(res.statusCode, 200);
		const body = parsed(res);
		assert.equal(body.expiresInSeconds, 300);
		const url = new URL(body.url);
		assert.equal(url.origin, "https://sub.example");
		const [, token, key] = url.pathname.split("/");
		assert.equal(verifyEphemeralCredentials("link-secret", token, key, Date.now(), 300), true);
		assert.equal(res.headers["cache-control"], "no-store");
	});

	test("the wrong PIN does not return a subscription URL", async () => {
		writePin("246810");
		const res = await call(issue, {
			body: { pin: "000000" },
			headers: { "x-forwarded-for": "203.0.113.11" },
		});
		assert.equal(res.statusCode, 401);
		assert.equal(parsed(res).error, "Incorrect PIN");
	});

	test("repeated PIN guesses are throttled", async () => {
		writePin("246810");
		const headers = { "x-forwarded-for": "203.0.113.12" };
		for (let i = 0; i < 8; i += 1) {
			const res = await call(issue, { body: { pin: "000000" }, headers });
			assert.equal(res.statusCode, 401);
		}
		const blocked = await call(issue, { body: { pin: "246810" }, headers });
		assert.equal(blocked.statusCode, 429);
	});

	test("administrator password gates PIN changes and writes the new PIN to the file", async () => {
		writePin("246810");
		const denied = await call(auth, {
			body: { password: "nope" },
			headers: { "x-forwarded-for": "203.0.113.20" },
		});
		assert.equal(denied.statusCode, 401);

		const allowed = await call(auth, {
			body: { password: "admin-secret" },
			headers: { "x-forwarded-for": "203.0.113.21" },
		});
		assert.equal(allowed.statusCode, 200);
		assert.equal(parsed(allowed).ok, true);

		const rejected = await call(changePin, {
			body: { password: "nope", pin: "135790" },
			headers: { "x-forwarded-for": "203.0.113.22" },
		});
		assert.equal(rejected.statusCode, 401);
		assert.equal(readConfiguredPin(), "246810");

		const saved = await call(changePin, {
			body: { password: "admin-secret", pin: "135790" },
			headers: { "x-forwarded-for": "203.0.113.23" },
		});
		assert.equal(saved.statusCode, 200);
		assert.equal(readConfiguredPin(), "135790");
	});

	test("PIN changes are refused when the administrator password is not configured", async () => {
		delete process.env.ADMIN_PASSWORD;
		writePin("246810");
		const res = await call(changePin, {
			body: { password: "admin-secret", pin: "135790" },
			headers: { "x-forwarded-for": "203.0.113.24" },
		});
		assert.equal(res.statusCode, 503);
		assert.equal(readConfiguredPin(), "246810");
	});

	test("an expired or forged link no longer serves the subscription", async () => {
		const now = 1_700_000_000_000;
		const minted = mintEphemeralCredentials(process.env.LINK_SECRET, now, 300);
		const expired = mockRes();
		await handleEphemeral(
			{ method: "GET", query: { token: minted.token, key: minted.key }, headers: {} },
			expired,
			now + 300_000,
		);
		assert.equal(expired.statusCode, 404);

		process.env.SUBSCRIPTION_URL = "";
		const fresh = mintEphemeralCredentials(process.env.LINK_SECRET, now, 300);
		const missingSource = mockRes();
		await handleEphemeral(
			{ method: "GET", query: { token: fresh.token, key: fresh.key }, headers: {} },
			missingSource,
			now,
		);
		assert.equal(missingSource.statusCode, 400);
		assert.match(String(missingSource.body), /Missing subscription source/);
	});

	test("the stable subscribe endpoint still requires its own token", async () => {
		process.env.SUBSCRIBE_TOKEN = "stable-token";
		delete process.env.SUBSCRIPTION_URL;
		const denied = mockRes();
		await subscribe({ method: "GET", query: { token: "nope" }, headers: {} }, denied);
		assert.equal(denied.statusCode, 401);

		const allowed = mockRes();
		await subscribe({ method: "GET", query: { token: "stable-token" }, headers: {} }, allowed);
		assert.equal(allowed.statusCode, 400);
		assert.match(String(allowed.body), /Missing subscription source/);
	});

	test("the root page collects a PIN and offers the subscription copy control", () => {
		const file = path.join(process.cwd(), "public", "index.html");
		assert.equal(fs.existsSync(file), true);
		const html = fs.readFileSync(file, "utf8");
		assert.match(html, /id="pin"/);
		assert.match(html, /id="copy"/);
		assert.match(html, /href="\/admin"/);
		assert.match(html, /viewport/);
	});

	test("the administrator page collects the server password and a new PIN", () => {
		const file = path.join(process.cwd(), "public", "admin", "index.html");
		assert.equal(fs.existsSync(file), true);
		const html = fs.readFileSync(file, "utf8");
		assert.match(html, /id="password"/);
		assert.match(html, /id="new-pin"/);
		assert.match(html, /viewport/);
	});
});
