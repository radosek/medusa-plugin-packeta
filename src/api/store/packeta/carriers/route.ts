import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PACKETA_MODULE } from "../../../../modules/packeta"
import type PacketaModuleService from "../../../../modules/packeta/service"
import { str } from "../../../lib/packets"

/**
 * GET /store/packeta/carriers?country=cz — public subset of the carrier feed so
 * storefronts can build widget `vendors` filters and pick the HD carrier id.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
	const packeta = req.scope.resolve<PacketaModuleService>(PACKETA_MODULE)
	const country = str((req.query as Record<string, unknown>).country)?.toLowerCase()
	const all = await packeta.getFeed().carriers()
	const carriers = all
		.filter((c) => c.available && (!country || c.country === country))
		.map((c) => ({
			id: c.id,
			name: c.name,
			country: c.country,
			currency: c.currency,
			pickup_points: c.pickupPoints,
			disallows_cod: c.disallowsCod,
			requires_size: c.requiresSize,
			requires_phone: c.requiresPhone,
			requires_email: c.requiresEmail,
			max_weight: c.maxWeight,
		}))
	const hd = country ? await packeta.getFeed().homeDeliveryCarrier(country) : undefined
	res.setHeader("Cache-Control", "public, max-age=3600")
	res.json({ carriers, home_delivery_carrier_id: hd?.id ?? null })
}
