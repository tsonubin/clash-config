import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearAttempts, recordFailure, tooManyAttempts } from "../attempt-limit.js";
import { buildSubscriptionUrl, configuredTtlSeconds, linkSecret } from "../ephemeral-link.js";
import { readConfiguredPin, validatePin } from "../pin-store.js";
import { clientIp, field, readBody, resolveOrigin, sendJson } from "../portal-http.js";
import { secretEqual } from "../secret-equal.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
	if (req.method !== "POST") {
		sendJson(res, 405, { error: "Method not allowed" });
		return;
	}

	const body = readBody(req);
	if (!body) {
		sendJson(res, 400, { error: "Expected JSON" });
		return;
	}

	const pin = field(body, "pin");
	const formatError = validatePin(pin);
	if (formatError) {
		sendJson(res, 400, { error: formatError });
		return;
	}

	const bucket = `pin:${clientIp(req)}`;
	const now = Date.now();
	if (tooManyAttempts(bucket, now)) {
		sendJson(res, 429, { error: "Too many attempts. Try again later." });
		return;
	}

	const stored = readConfiguredPin();
	if (!stored) {
		sendJson(res, 503, { error: "PIN is not configured" });
		return;
	}
	if (!secretEqual(stored, pin)) {
		recordFailure(bucket, now);
		sendJson(res, 401, { error: "Incorrect PIN" });
		return;
	}
	clearAttempts(bucket);

	const secret = linkSecret();
	if (!secret) {
		sendJson(res, 503, { error: "Link signing secret is not configured" });
		return;
	}

	const origin = resolveOrigin(req);
	if (!origin) {
		sendJson(res, 500, { error: "Public origin is not configured" });
		return;
	}

	let ttlSeconds: number;
	try {
		ttlSeconds = configuredTtlSeconds();
	} catch {
		sendJson(res, 500, { error: "Link TTL is not configured" });
		return;
	}

	sendJson(res, 200, buildSubscriptionUrl(origin, secret, now, ttlSeconds));
}
