import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { PACKETA_MODULE } from "../../../../modules/packeta"
import type PacketaModuleService from "../../../../modules/packeta/service"
import { PACKETA_STATUSES } from "../../../../providers/packeta/lib/status"
import { int, ordersById, serialisePacket, str } from "../../../lib/packets"

/**
 * GET /admin/packeta/packets
 * ?order_id= ?fulfillment_id= ?kind= ?status_group= ?q= ?limit= ?offset=
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
	const packeta = req.scope.resolve<PacketaModuleService>(PACKETA_MODULE)
	const q = req.query as Record<string, unknown>
	const limit = int(q.limit, 50, 200)
	const offset = int(q.offset, 0)

	const filters: Record<string, unknown> = {}
	const orderId = str(q.order_id)
	const fulfillmentId = str(q.fulfillment_id)
	const kind = str(q.kind)
	const group = str(q.status_group)
	const search = str(q.q)
	if (orderId) filters.order_id = orderId
	if (fulfillmentId) filters.fulfillment_id = fulfillmentId
	if (kind) filters.kind = kind
	if (group === "cancelled") {
		filters.cancelled_at = { $ne: null }
	} else if (group) {
		const ids = PACKETA_STATUSES.filter((s) => s.group === group).map((s) => s.id)
		filters.status_id = group === "created" ? { $in: [...ids, null] } : { $in: ids }
		filters.cancelled_at = null
	}
	if (search) {
		const like = `%${search.replace(/^Z/i, "")}%`
		filters.$or = [
			{ barcode: { $ilike: `%${search}%` } },
			{ packet_id: { $ilike: like } },
			{ number: { $ilike: `%${search}%` } },
		]
	}

	const [rows, count] = await packeta.listAndCountPacketaPackets(filters, {
		take: limit,
		skip: offset,
		order: { created_at: "DESC" },
	})
	const orders = await ordersById(req, rows.map((r) => r.order_id ?? "").filter(Boolean))
	res.json({
		packets: rows.map((r) => serialisePacket(r, r.order_id ? orders.get(r.order_id) : null)),
		count,
		limit,
		offset,
	})
}
