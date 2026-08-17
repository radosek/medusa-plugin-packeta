import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PACKETA_MODULE } from "../../../modules/packeta"
import type PacketaModuleService from "../../../modules/packeta/service"
import type { PacketaPushEvent } from "../../../providers/packeta/types"
import { syncPacketStatusWorkflow } from "../../../workflows/sync-packet-status"
import { verifyPacketaSignature } from "../../lib/webhook"

/**
 * Packeta push-tracking webhook. Register this URL with integrations@packeta.com;
 * they issue the signing key (`webhook_signing_key`). Packeta retries anything
 * that is not 200/202, so after authentication we always answer 200 — a packet
 * we do not know is logged, not retried forever.
 */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
	const logger = req.scope.resolve("logger")
	const packeta = req.scope.resolve<PacketaModuleService>(PACKETA_MODULE)
	const options = packeta.getOptions()

	const raw: string | Buffer | undefined = (req as MedusaRequest & { rawBody?: string | Buffer }).rawBody
	const rawBody = raw ?? JSON.stringify(req.body ?? {})

	if (options.webhook_signing_key) {
		const timestamp = header(req, "x-webhook-timestamp")
		if (!isFresh(timestamp, options.webhook_tolerance_s)) {
			res.status(401).json({ message: "stale or missing timestamp" })
			return
		}
		const ok = verifyPacketaSignature(
			options.webhook_signing_key,
			timestamp,
			header(req, "x-webhook-signature"),
			rawBody,
		)
		if (!ok) {
			res.status(401).json({ message: "invalid signature" })
			return
		}
	} else if (options.allow_unsigned_webhook && process.env.NODE_ENV === "production") {
		logger.error(
			"Packeta webhook: `allow_unsigned_webhook` is ignored in production; configure `webhook_signing_key`.",
		)
		res.status(503).json({ message: "webhook signing key not configured" })
		return
	} else if (!options.allow_unsigned_webhook) {
		logger.warn(
			"Packeta webhook received but `webhook_signing_key` is not configured; rejecting. Set `allow_unsigned_webhook: true` for local testing.",
		)
		res.status(503).json({ message: "webhook signing key not configured" })
		return
	}

	const event = (
		typeof req.body === "object" && req.body ? req.body : safeJson(rawBody)
	) as PacketaPushEvent | null
	const payload =
		event && "status" in event
			? event.status
			: event && "externalStatus" in event
				? event.externalStatus
				: null
	if (!payload?.id && !payload?.barcode) {
		res.status(400).json({ message: "unrecognised payload" })
		return
	}
	const packetId = String(payload.id ?? String(payload.barcode).replace(/^Z/i, ""))
	const eventId = header(req, "x-webhook-event-id") ?? payload.eventId

	try {
		await syncPacketStatusWorkflow(req.scope).run({
			input: { packet_id: packetId, event: event as PacketaPushEvent, event_id: eventId },
		})
	} catch (e) {
		if (e instanceof MedusaError && e.type === MedusaError.Types.NOT_FOUND) {
			logger.info(`Packeta webhook: unknown packet ${packetId}, ignoring.`)
		} else {
			logger.error(`Packeta webhook: failed to apply status for packet ${packetId}: ${(e as Error).message}`)
		}
	}
	res.status(200).json({ received: true })
}

function header(req: MedusaRequest, name: string): string | undefined {
	const v = req.headers[name]
	return Array.isArray(v) ? v[0] : v
}

function safeJson(raw: string | Buffer): unknown {
	try {
		return JSON.parse(raw.toString())
	} catch {
		return null
	}
}

/** Reject timestamps outside ±tolerance (replay protection); the signature covers the timestamp. */
function isFresh(timestamp: string | undefined, toleranceS: number): boolean {
	const ts = Number(timestamp)
	if (!timestamp || !Number.isFinite(ts)) return false
	return Math.abs(Date.now() / 1000 - ts) <= toleranceS
}
