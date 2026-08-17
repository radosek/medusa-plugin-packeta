import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Verify a Packeta push-tracking signature:
 * `X-Webhook-Signature` = hex HMAC-SHA256(signingKey, `${X-Webhook-Timestamp}.${rawBody}`).
 */
export function verifyPacketaSignature(
	signingKey: string,
	timestamp: string | undefined,
	signature: string | undefined,
	rawBody: string | Buffer,
): boolean {
	if (!timestamp || !signature) return false
	const expected = createHmac("sha256", signingKey).update(`${timestamp}.`).update(rawBody).digest("hex")
	const a = Buffer.from(expected, "utf8")
	const b = Buffer.from(signature.trim().toLowerCase(), "utf8")
	return a.length === b.length && timingSafeEqual(a, b)
}

/** Build the signature the way Packeta does (tests, smoke script). */
export function signPacketaWebhook(signingKey: string, timestamp: string, rawBody: string): string {
	return createHmac("sha256", signingKey).update(`${timestamp}.${rawBody}`).digest("hex")
}
