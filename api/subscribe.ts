import type { VercelRequest, VercelResponse } from "@vercel/node";
import { serveSubscription } from "./subscription.js";

export default function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
	return serveSubscription(req, res);
}
