import type { VercelRequest, VercelResponse } from "@vercel/node";
import {
	configuredTtlSeconds,
	linkSecret,
	verifyEphemeralCredentials,
} from "./ephemeral-link.js";
import { firstQueryValue, serveSubscription } from "./subscription.js";

export async function handleEphemeral(
	req: VercelRequest,
	res: VercelResponse,
	nowMs = Date.now(),
): Promise<void> {
	if (req.method !== "GET") {
		res.setHeader("Cache-Control", "no-store");
		res.status(405).send("Method not allowed");
		return;
	}

	const token = firstQueryValue(req.query.token);
	const key = firstQueryValue(req.query.key);
	const secret = linkSecret();
	let ttlSeconds: number;
	try {
		ttlSeconds = configuredTtlSeconds();
	} catch {
		res.setHeader("Cache-Control", "no-store");
		res.status(500).send("Link TTL is not configured");
		return;
	}

	if (!secret || !token || !key || !verifyEphemeralCredentials(secret, token, key, nowMs, ttlSeconds)) {
		res.setHeader("Cache-Control", "no-store");
		res.status(404).send("Not found");
		return;
	}

	await serveSubscription(req, res, { skipStableToken: true });
}

export default function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
	return handleEphemeral(req, res);
}
