import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PACKETA_MODULE } from "#src/modules/packeta/index"
import type PacketaModuleService from "#src/modules/packeta/service"
import { applyCarrierFilter } from "#src/providers/packeta/lib/feed"
import { str } from "#src/api/lib/packets"

/**
 * GET /admin/packeta/carriers?country=cz&refresh=1 — full carrier feed
 * (cached). `enabled` marks carriers that pass the configured `carrier_filter`
 * and `enabled_carriers` whitelist.
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
	const packeta = req.scope.resolve<PacketaModuleService>(PACKETA_MODULE)
	const q = req.query as Record<string, unknown>
	if (["1", "true"].includes(String(q.refresh ?? ""))) packeta.getFeed().invalidate()
	const country = str(q.country)?.toLowerCase()
	const options = packeta.getOptions()
	const all = (await packeta.getFeed().carriers()).filter((c) => !country || c.country === country)
	const whitelist = options.enabled_carriers
	const enabledIds = new Set(
		applyCarrierFilter(all, options.carrier_filter)
			.filter((c) => c.available && (whitelist === "all" || whitelist.includes(c.id)))
			.map((c) => c.id),
	)
	const carriers = all.map((c) => Object.assign({}, c, { enabled: enabledIds.has(c.id) }))
	res.json({ carriers, count: carriers.length })
}
