const LIMIT = 8;
const WINDOW_MS = 10 * 60 * 1000;

interface Bucket {
	failures: number;
	resetAt: number;
}

const buckets = new Map<string, Bucket>();

export function resetAttempts(): void {
	buckets.clear();
}

export function tooManyAttempts(key: string, now: number): boolean {
	const bucket = buckets.get(key);
	if (!bucket || now >= bucket.resetAt) return false;
	return bucket.failures >= LIMIT;
}

export function recordFailure(key: string, now: number): void {
	const bucket = buckets.get(key);
	if (!bucket || now >= bucket.resetAt) {
		buckets.set(key, { failures: 1, resetAt: now + WINDOW_MS });
		return;
	}
	bucket.failures += 1;
}

export function clearAttempts(key: string): void {
	buckets.delete(key);
}
