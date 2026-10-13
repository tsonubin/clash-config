import type { VercelRequest, VercelResponse } from "@vercel/node";

export function sendJson(res: VercelResponse, status: number, body: Record<string, unknown>): void {
	res.setHeader("Content-Type", "application/json; charset=utf-8");
	res.setHeader("Cache-Control", "no-store");
	res.status(status).send(JSON.stringify(body));
}

export function clientIp(req: VercelRequest): string {
	const forwarded = req.headers["x-forwarded-for"];
	const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
	const ip = raw?.split(",")[0]?.trim();
	return ip || "unknown";
}

export function readBody(req: VercelRequest): Record<string, unknown> | null {
	const body = req.body as unknown;
	if (Buffer.isBuffer(body)) return null;
	if (body && typeof body === "object") return body as Record<string, unknown>;
	if (typeof body === "string") {
		try {
			const parsed = JSON.parse(body) as unknown;
			if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
				return parsed as Record<string, unknown>;
			}
		} catch {
			return null;
		}
		return null;
	}
	return {};
}

export function field(body: Record<string, unknown>, key: string): string {
	const value = body[key];
	return typeof value === "string" ? value : "";
}

export function resolveOrigin(req: VercelRequest): string | null {
	const configured = process.env.PUBLIC_ORIGIN?.trim();
	if (configured) {
		try {
			const url = new URL(configured);
			if (url.protocol !== "https:" && url.protocol !== "http:") return null;
			return url.origin;
		} catch {
			return null;
		}
	}

	const forwardedHost = req.headers["x-forwarded-host"];
	const hostHeader = req.headers.host;
	const hostRaw = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost) ||
		(Array.isArray(hostHeader) ? hostHeader[0] : hostHeader) ||
		"";
	const host = hostRaw.split(",")[0]?.trim() ?? "";
	if (!/^[A-Za-z0-9.:-]+$/.test(host)) return null;

	const forwardedProto = req.headers["x-forwarded-proto"];
	const protoRaw = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto) || "";
	let proto = protoRaw.split(",")[0]?.trim();
	if (!proto) {
		proto = host.startsWith("localhost") || host.startsWith("127.0.0.1") ? "http" : "https";
	}
	if (proto !== "http" && proto !== "https") return null;
	return `${proto}://${host}`;
}
