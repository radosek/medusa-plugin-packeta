import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PACKETA_MODULE } from "../../../../modules/packeta"
import type PacketaModuleService from "../../../../modules/packeta/service"
import { PacketaError } from "../../../../providers/packeta/lib/client"

/**
 * GET /admin/packeta/health — are the credentials good and the feed reachable?
 * The API password is probed with `packetStatus("1")`: a valid password answers
 * `PacketIdFault`, a bad one `IncorrectApiPasswordFault`.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
	const packeta = req.scope.resolve<PacketaModuleService>(PACKETA_MODULE)
	const options = packeta.getOptions()

	let api: { ok: boolean; message?: string } = { ok: false }
	try {
		await packeta.getClient().packetStatus("1")
		api = { ok: true }
	} catch (e) {
		if (
			e instanceof PacketaError &&
			e.fault !== "IncorrectApiPasswordFault" &&
			e.fault !== "NetworkError" &&
			!e.fault.startsWith("HTTP")
		)
			api = { ok: true }
		else api = { ok: false, message: (e as Error).message }
	}

	let feed: { ok: boolean; carriers?: number; message?: string } = { ok: false }
	try {
		const carriers = await packeta.getFeed().carriers()
		feed = { ok: true, carriers: carriers.length }
	} catch (e) {
		feed = { ok: false, message: (e as Error).message }
	}

	res.json({
		api,
		feed,
		webhook: {
			signing_key_configured: !!options.webhook_signing_key,
			allow_unsigned: options.allow_unsigned_webhook,
			path: "/hooks/packeta",
		},
		options: {
			eshop: options.eshop,
			label_format: options.label_format,
			expose_carriers: options.expose_carriers,
			enabled_carriers: options.enabled_carriers,
			cod_payment_providers: options.cod_payment_providers,
			validate_pickup_point: options.validate_pickup_point,
			auto_ship_status_ids: options.auto_ship_status_ids,
			auto_deliver_status_ids: options.auto_deliver_status_ids,
		},
	})
}
