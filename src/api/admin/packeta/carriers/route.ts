import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PACKETA_MODULE } from "../../../../modules/packeta"
import type PacketaModuleService from "../../../../modules/packeta/service"
import { str } from "../../../lib/packets"

/** GET /admin/packeta/carriers?country=cz&refresh=1 — full carrier feed (cached). */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
	const packeta = req.scope.resolve<PacketaModuleService>(PACKETA_MODULE)
	const q = req.query as Record<string, unknown>
	if (["1", "true"].includes(String(q.refresh ?? ""))) packeta.getFeed().invalidate()
	const country = str(q.country)?.toLowerCase()
	const carriers = (await packeta.getFeed().carriers()).filter((c) => !country || c.country === country)
	res.json({ carriers, count: carriers.length })
}
