import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, timingSafeEqual } from "node:crypto";
import yaml from "js-yaml";
import { rewrite, UpstreamConfigError, type ClashConfig } from "./rewrite.js";

const FETCH_TIMEOUT_MS = 15_000;
// Subscriptions are small (well under 1 MiB); the cap only bounds memory and
// YAML parse cost against a broken or hostile upstream.
const MAX_UPSTREAM_BYTES = 8 * 1024 * 1024;
// The body carries relay credentials, so no shared or browser cache may keep
// a copy: a token in the URL does not stop a CDN or proxy from storing it.
const SUCCESS_CACHE_CONTROL = "private, no-store";

// Fixed-length, non-early-exit comparison so the token check cannot be probed
// byte-by-byte through response timing.
function secretEqual(a: string, b: string): boolean {
	const ha = createHash("sha256").update(a).digest();
	const hb = createHash("sha256").update(b).digest();
	return timingSafeEqual(ha, hb);
}

// Reads the body as UTF-8, returning undefined once more than `limit` bytes
// arrive (the rest of the stream is cancelled, never buffered).
async function readCapped(response: Response, limit: number): Promise<string | undefined> {
	if (!response.body) return "";
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		total += value.byteLength;
		if (total > limit) {
			void reader.cancel().catch(() => {});
			return undefined;
		}
		chunks.push(value);
	}
	return Buffer.concat(chunks).toString("utf8");
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

// Fetches the upstream subscription and rewrites it server-side, so any
// Clash-compatible client (Stash, mihomo, Verge) can subscribe to the result
// directly. The emitted config is self-contained: it carries its own DNS and
// sniffer sections and does not depend on client-side override toggles.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	// Nothing is cached: errors are transient and successes carry credentials.
	res.setHeader("Cache-Control", "no-store");
	const method = req.method ?? "GET";
	if (method !== "GET" && method !== "HEAD") {
		res.setHeader("Allow", "GET, HEAD");
		res.status(405).send("Method not allowed: use GET or HEAD.");
		return;
	}
	// Flag-like envs accept only 0/1 (or empty). Anything else is a silent
	// misconfiguration — e.g. REQUIRE_SUBSCRIBE_TOKEN=true would quietly not
	// fail closed — so refuse to serve instead of guessing.
	const rawRequireToken = process.env.REQUIRE_SUBSCRIBE_TOKEN;
	const rawAllowOverride = process.env.ALLOW_URL_OVERRIDE;
	for (const raw of [rawRequireToken, rawAllowOverride]) {
		if (raw !== undefined && raw !== "" && raw !== "0" && raw !== "1") {
			res
				.status(503)
				.send("Server misconfigured: REQUIRE_SUBSCRIBE_TOKEN and ALLOW_URL_OVERRIDE must be 0 or 1");
			return;
		}
	}
	const requiredToken = process.env.SUBSCRIBE_TOKEN;
	// Opt-in fail-closed: with REQUIRE_SUBSCRIBE_TOKEN=1 a missing SUBSCRIBE_TOKEN
	// refuses every request instead of silently serving the (credential-bearing)
	// config unauthenticated. Unset, behavior is unchanged.
	if (!requiredToken && rawRequireToken === "1") {
		res.status(503).send("Server misconfigured: SUBSCRIBE_TOKEN is not set");
		return;
	}
	const providedToken = firstQueryValue(req.query.token);
	if (requiredToken && !secretEqual(providedToken ?? "", requiredToken)) {
		res.status(401).send("Unauthorized: missing or incorrect ?token=");
		return;
	}

	const configuredUrl = process.env.SUBSCRIPTION_URL;
	const allowUrlOverride = rawAllowOverride === "1";
	const queryUrl = firstQueryValue(req.query.url);
	// ?url= genuinely overrides when the escape hatch is enabled; without it the
	// environment is the only source.
	const overridden = allowUrlOverride && Boolean(queryUrl);
	const sourceUrl = overridden ? queryUrl : configuredUrl;

	if (!sourceUrl) {
		res
			.status(400)
			.send(
				"Missing subscription source: set the SUBSCRIPTION_URL environment variable (recommended), " +
					"or set ALLOW_URL_OVERRIDE=1 and pass ?url=<encoded subscription URL>.",
			);
		return;
	}

	// Restrict the source to http(s) so no scheme (file:, data:, …) or garbage
	// can reach fetch. A caller-supplied ?url= is the client's mistake (400); a
	// bad configured SUBSCRIPTION_URL is an operator error (500).
	let protocol: string | undefined;
	try {
		protocol = new URL(sourceUrl).protocol;
	} catch {
		protocol = undefined; // unparsable → rejected below
	}
	if (protocol !== "http:" && protocol !== "https:") {
		res
			.status(overridden ? 400 : 500)
			.send(
				overridden
					? "Invalid ?url=: must be an http(s) URL"
					: "Invalid SUBSCRIPTION_URL: must be an http(s) URL",
			);
		return;
	}

	let upstream: Response;
	let rawYaml: string;
	// The abort timer spans fetch *and* body read: clearing it once headers
	// arrive would let a slow-drip body hang the function indefinitely.
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
	try {
		upstream = await fetch(sourceUrl, {
			headers: { "User-Agent": "ClashX/1.95.1 clash-verge/mihomo" },
			signal: controller.signal,
		});
		if (!upstream.ok) {
			res.status(502).send(`Upstream subscription returned HTTP ${upstream.status}`);
			return;
		}
		const declared = Number(upstream.headers.get("content-length"));
		if (declared > MAX_UPSTREAM_BYTES) {
			res.status(502).send("Upstream subscription is too large");
			return;
		}
		// Content-Length can be absent (chunked) or understated, so count bytes
		// while streaming and stop as soon as the cap is crossed.
		const body = await readCapped(upstream, MAX_UPSTREAM_BYTES);
		if (body === undefined) {
			controller.abort();
			res.status(502).send("Upstream subscription is too large");
			return;
		}
		rawYaml = body;
	} catch (err) {
		// Detail stays in the logs: fetch errors can name the upstream URL.
		console.error("Upstream subscription fetch failed:", err);
		res.status(502).send("Upstream subscription fetch failed");
		return;
	} finally {
		clearTimeout(timer);
	}

	let config: ClashConfig;
	try {
		// js-yaml v4's `load()` already rejects `!!python/...`-style custom type
		// tags by default (it folded the old `safeLoad` into `load`), so this is
		// not the classic PyYAML arbitrary-object-construction footgun.
		config = yaml.load(rawYaml) as ClashConfig;
	} catch (err) {
		// Parse errors quote the offending YAML; give the caller only the
		// position and keep content snippets in the logs.
		const mark = err instanceof yaml.YAMLException ? err.mark : undefined;
		const where = mark ? ` (line ${mark.line + 1}, column ${mark.column + 1})` : "";
		console.error("Upstream subscription is not valid YAML:", err);
		res.status(502).send(`Upstream subscription is not valid YAML${where}`);
		return;
	}

	let rewritten: ClashConfig;
	try {
		rewritten = rewrite(config);
	} catch (err) {
		if (err instanceof UpstreamConfigError) {
			// Curated and self-describing; "Rewrite error:" would mislabel an
			// upstream problem as an internal one.
			res.status(502).send(err.message);
			return;
		}
		console.error("Rewrite error:", err);
		res.status(500).send(`Rewrite error: ${(err as Error).message}`);
		return;
	}

	const outputYaml = yaml.dump(rewritten, { lineWidth: -1, noRefs: true });

	res.setHeader("Content-Type", "text/yaml; charset=utf-8");
	res.setHeader("Cache-Control", SUCCESS_CACHE_CONTROL);

	// Pass through quota/expiry headers so clients still show traffic usage.
	// Best effort: Node's setHeader throws on values outside its charset, and a
	// broken or hostile upstream must never cost us the whole response.
	// Printable ASCII + tab is all these headers ever legitimately carry.
	for (const name of ["subscription-userinfo", "content-disposition"] as const) {
		const value = upstream.headers.get(name);
		if (!value) continue;
		if (/^[\t\x20-\x7e]*$/.test(value)) res.setHeader(name, value);
		else console.error(`Dropping malformed upstream header ${name}`);
	}

	res.status(200).send(outputYaml);
}
