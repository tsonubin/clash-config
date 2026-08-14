import type { VercelRequest, VercelResponse } from "@vercel/node";
import yaml from "js-yaml";
import { rewrite, type ClashConfig } from "./rewrite.js";

const FETCH_TIMEOUT_MS = 15_000;

function firstQueryValue(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

async function fetchUpstream(url: string): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

	try {
		return await fetch(url, {
			headers: { "User-Agent": "ClashX/1.95.1 clash-verge/mihomo" },
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}

// Fetches the upstream subscription and rewrites it server-side, so any
// Clash-compatible client (Stash, mihomo, Verge) can subscribe to the result
// directly. The emitted config is self-contained: it carries its own DNS and
// sniffer sections and does not depend on client-side override toggles.
export default async function handler(req: VercelRequest, res: VercelResponse) {
	const requiredToken = process.env.SUBSCRIBE_TOKEN;
	const providedToken = firstQueryValue(req.query.token);
	if (requiredToken && providedToken !== requiredToken) {
		res.status(401).send("Unauthorized: missing or incorrect ?token=");
		return;
	}

	const configuredUrl = process.env.SUBSCRIPTION_URL;
	const allowUrlOverride = process.env.ALLOW_URL_OVERRIDE === "1";
	const queryUrl = firstQueryValue(req.query.url);
	const sourceUrl = configuredUrl || (allowUrlOverride ? queryUrl : undefined);

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
	try {
		upstream = await fetchUpstream(sourceUrl);
	} catch (err) {
		res.status(502).send(`Upstream subscription fetch failed: ${(err as Error).message}`);
		return;
	}

	if (!upstream.ok) {
		res.status(502).send(`Upstream subscription returned HTTP ${upstream.status}`);
		return;
	}

	const rawYaml = await upstream.text();

	let config: ClashConfig;
	try {
		// js-yaml v4's `load()` already rejects `!!python/...`-style custom type
		// tags by default (it folded the old `safeLoad` into `load`), so this is
		// not the classic PyYAML arbitrary-object-construction footgun.
		config = yaml.load(rawYaml) as ClashConfig;
	} catch (err) {
		res.status(502).send(`Upstream subscription is not valid YAML: ${(err as Error).message}`);
		return;
	}

	let rewritten: ClashConfig;
	try {
		rewritten = rewrite(config);
	} catch (err) {
		res.status(500).send(`Rewrite error: ${(err as Error).message}`);
		return;
	}

	const outputYaml = yaml.dump(rewritten, { lineWidth: -1, noRefs: true });

	res.setHeader("Content-Type", "text/yaml; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");

	// Pass through quota/expiry headers so clients still show traffic usage.
	const userInfo = upstream.headers.get("subscription-userinfo");
	if (userInfo) res.setHeader("subscription-userinfo", userInfo);
	const disposition = upstream.headers.get("content-disposition");
	if (disposition) res.setHeader("content-disposition", disposition);

	res.status(200).send(outputYaml);
}
