import crypto from "crypto";

// Hash both sides before comparing so a different length cannot skip the
// constant-time check or reveal how long the stored secret is.
export function secretEqual(left: string, right: string): boolean {
	const a = crypto.createHash("sha256").update(left, "utf8").digest();
	const b = crypto.createHash("sha256").update(right, "utf8").digest();
	return crypto.timingSafeEqual(a, b);
}
