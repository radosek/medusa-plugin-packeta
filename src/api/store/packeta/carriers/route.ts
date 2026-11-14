import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PACKETA_MODULE } from "#src/modules/packeta/index"
import type PacketaModuleService from "#src/modules/packeta/service"
import { applyCarrierFilter, carrierType } from "#src/providers/packeta/lib/feed"
import type { PacketaCarrierType } from "#src/providers/packeta/types"
import { str } from "#src/api/lib/packets"

/**
 * GET /store/packeta/carriers?country=cz&type=hd,box&cod=1 — public subset of
 * the carrier feed so storefronts can build widget `vendors` filters and pick
 * the HD carrier id. The configured `carrier_filter` applies first; the query
 * parameters narrow the result further.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
	const packeta = req.scope.resolve<PacketaModuleService>(PACKETA_MODULE)
	const q = req.query as Record<string, unknown>
	const country = str(q.country)?.toLowerCase()
	const types = str(q.type)
		?.split(",")
		.map((t) => t.trim())
		.filter(Boolean) as PacketaCarrierType[] | undefined
	const cod = ["1", "true"].includes(String(q.cod ?? "").toLowerCase())
	const filter = packeta.getOptions().carrier_filter
	const all = await packeta.getFeed().carriers()
	const carriers = applyCarrierFilter(all, filter)
		.filter(
			(c) =>
				c.available &&
				(!country || c.country === country) &&
				(!types?.length || types.includes(carrierType(c))) &&
				(!cod || !c.disallowsCod),
		)
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
	const hd = country ? await packeta.getFeed().homeDeliveryCarrier(country, filter) : undefined
	res.setHeader("Cache-Control", "public, max-age=3600")
	res.json({ carriers, home_delivery_carrier_id: hd?.id ?? null })
}
