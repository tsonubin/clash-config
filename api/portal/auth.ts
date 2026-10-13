import type { VercelRequest, VercelResponse } from "@vercel/node";
import { clearAttempts, recordFailure, tooManyAttempts } from "../attempt-limit.js";
import { clientIp, field, readBody, sendJson } from "../portal-http.js";
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

	const bucket = `admin:${clientIp(req)}`;
	const now = Date.now();
	if (tooManyAttempts(bucket, now)) {
		sendJson(res, 429, { error: "Too many attempts. Try again later." });
		return;
	}

	const expected = process.env.ADMIN_PASSWORD?.trim() ?? "";
	if (!expected) {
		sendJson(res, 503, { error: "Administrator password is not configured" });
		return;
	}
	if (!secretEqual(expected, field(body, "password"))) {
		recordFailure(bucket, now);
		sendJson(res, 401, { error: "Incorrect password" });
		return;
	}

	clearAttempts(bucket);
	sendJson(res, 200, { ok: true });
}
