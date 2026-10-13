import crypto from "crypto";

export const DEFAULT_LINK_TTL_SECONDS = 300;
const TOKEN_RANDOM_BYTES = 16;
const TOKEN_BYTES = 4 + TOKEN_RANDOM_BYTES;
const SKEW_SECONDS = 30;

function encode(buf: Buffer): string {
	return buf.toString("base64url");
}

function decode(value: string): Buffer | null {
	if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
	const buf = Buffer.from(value, "base64url");
	if (buf.length === 0 || encode(buf) !== value) return null;
	return buf;
}

export function linkSecret(env: NodeJS.ProcessEnv = process.env): string | null {
	const value = env.LINK_SECRET?.trim() || env.SUBSCRIBE_TOKEN?.trim() || "";
	return value || null;
}

export function configuredTtlSeconds(raw = process.env.LINK_TTL_SECONDS): number {
	if (raw === undefined || raw.trim() === "") return DEFAULT_LINK_TTL_SECONDS;
	const parsed = Number(raw);
	if (!Number.isInteger(parsed) || parsed < 30 || parsed > 3600) {
		throw new Error(`Invalid LINK_TTL_SECONDS: ${raw}`);
	}
	return parsed;
}

// The path embeds an expiry plus random bytes. The key is an HMAC of that
// path, so a later request can be checked on any instance without a shared
// link database. Changing either segment, or waiting out the expiry, makes
// the link fail closed.
export function mintEphemeralCredentials(
	secret: string,
	nowMs: number,
	ttlSeconds: number,
): { token: string; key: string } {
	const expiry = Math.floor(nowMs / 1000) + ttlSeconds;
	const tokenBuf = Buffer.alloc(TOKEN_BYTES);
	tokenBuf.writeUInt32BE(expiry >>> 0, 0);
	crypto.randomBytes(TOKEN_RANDOM_BYTES).copy(tokenBuf, 4);
	const token = encode(tokenBuf);
	const key = encode(crypto.createHmac("sha256", secret).update(token).digest());
	return { token, key };
}

export function verifyEphemeralCredentials(
	secret: string,
	token: string,
	key: string,
	nowMs: number,
	ttlSeconds: number,
): boolean {
	if (!secret) return false;
	const tokenBuf = decode(token);
	const keyBuf = decode(key);
	if (!tokenBuf || tokenBuf.length !== TOKEN_BYTES || !keyBuf || keyBuf.length !== 32) return false;

	const expected = crypto.createHmac("sha256", secret).update(token).digest();
	if (!crypto.timingSafeEqual(expected, keyBuf)) return false;

	const expiry = tokenBuf.readUInt32BE(0);
	const nowSec = Math.floor(nowMs / 1000);
	if (nowSec >= expiry) return false;
	if (expiry - nowSec > ttlSeconds + SKEW_SECONDS) return false;
	return true;
}

export function buildSubscriptionUrl(
	origin: string,
	secret: string,
	nowMs: number,
	ttlSeconds: number,
): { url: string; expiresInSeconds: number } {
	const { token, key } = mintEphemeralCredentials(secret, nowMs, ttlSeconds);
	const base = origin.replace(/\/$/, "");
	return { url: `${base}/${token}/${key}`, expiresInSeconds: ttlSeconds };
}
