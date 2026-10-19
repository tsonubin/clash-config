import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createHash, timingSafeEqual } from "node:crypto";
import yaml from "js-yaml";
import { rewrite, UpstreamConfigError, type ClashConfig } from "./rewrite.js";

const FETCH_TIMEOUT_MS = 15_000;
// Subscriptions are small (well under 1 MiB); the cap only bounds memory and
// YAML parse cost against a broken or hostile upstream.
const MAX_UPSTREAM_BYTES = 8 * 1024 * 1024;
// Successful responses may sit in a shared cache for a minute (refreshed in the
// background for 10 more) so client refreshes don't hammer the upstream
// subscription. The token is part of the URL, hence part of the cache key; only
// callers who could fetch the body anyway can hit a cached copy.
const SUCCESS_CACHE_CONTROL = "public, s-maxage=60, stale-while-revalidate=600";

// Fixed-length, non-early-exit comparison so the token check cannot be probed
// byte-by-byte through response timing.
function secretEqual(a: string, b: string): boolean {
	const ha = createHash("sha256").update(a).digest();
	const hb = createHash("sha256").update(b).digest();
	return timingSafeEqual(ha, hb);
}

function firstQueryValue(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

// Fetches the upstream subscription and rewrites it server-side, so any
// Clash-compatible client (Stash, mihomo, Verge) can subscribe to the result
// directly. The emitted config is self-contained: it carries its own DNS and
// sniffer sections and does not depend on client-side override toggles.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	// Errors are never cached; the success path opts into the CDN cache below.
	res.setHeader("Cache-Control", "no-store");
	const method = req.method ?? "GET";
	if (method !== "GET" && method !== "HEAD") {
		res.setHeader("Allow", "GET, HEAD");
		res.status(405).send("Method not allowed");
		return;
	}
	const requiredToken = process.env.SUBSCRIBE_TOKEN;
	// Opt-in fail-closed: with REQUIRE_SUBSCRIBE_TOKEN=1 a missing SUBSCRIBE_TOKEN
	// refuses every request instead of silently serving the (credential-bearing)
	// config unauthenticated. Unset, behavior is unchanged.
	if (!requiredToken && process.env.REQUIRE_SUBSCRIBE_TOKEN === "1") {
		res.status(503).send("Server misconfigured: SUBSCRIBE_TOKEN is not set");
		return;
	}
	const providedToken = firstQueryValue(req.query.token);
	if (requiredToken && !secretEqual(providedToken ?? "", requiredToken)) {
		res.status(401).send("Unauthorized: missing or incorrect ?token=");
		return;
	}

	const configuredUrl = process.env.SUBSCRIPTION_URL;
	const allowUrlOverride = process.env.ALLOW_URL_OVERRIDE === "1";
	const queryUrl = firstQueryValue(req.query.url);
	// ?url= genuinely overrides when the escape hatch is enabled; without it the
	// environment is the only source. Caller-supplied, so restrict it to http(s):
	// any other scheme (file:, data:, …) or an unparsable value is rejected
	// before it can reach fetch.
	if (allowUrlOverride && queryUrl) {
		let queryProtocol: string | undefined;
		try {
			queryProtocol = new URL(queryUrl).protocol;
		} catch {
			queryProtocol = undefined; // unparsable → rejected below
		}
		if (queryProtocol !== "http:" && queryProtocol !== "https:") {
			res.status(400).send("Invalid ?url=: must be an http(s) URL");
			return;
		}
	}
	const sourceUrl = allowUrlOverride && queryUrl ? queryUrl : configuredUrl;

	if (!sourceUrl) {
		res
			.status(400)
			.send(
				"Missing subscription source: set the SUBSCRIPTION_URL environment variable (recommended), " +
					"or set ALLOW_URL_OVERRIDE=1 and pass ?url=<encoded subscription URL>.",
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
		rawYaml = await upstream.text();
		if (rawYaml.length > MAX_UPSTREAM_BYTES) {
			res.status(502).send("Upstream subscription is too large");
			return;
		}
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
		// Parse errors quote the offending YAML; keep those snippets out of the
		// response body.
		console.error("Upstream subscription is not valid YAML:", err);
		res.status(502).send("Upstream subscription is not valid YAML");
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
	const userInfo = upstream.headers.get("subscription-userinfo");
	if (userInfo) res.setHeader("subscription-userinfo", userInfo);
	const disposition = upstream.headers.get("content-disposition");
	if (disposition) res.setHeader("content-disposition", disposition);

	res.status(200).send(outputYaml);
}
