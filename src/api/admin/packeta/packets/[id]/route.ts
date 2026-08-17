import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { findPacket, ordersById, serialisePacket } from "../../../../lib/packets"

/** GET /admin/packeta/packets/:id — `:id` is the Packeta packet id (with or without Z) or the record id. */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
	const packet = await findPacket(req, req.params.id)
	const orders = packet.order_id ? await ordersById(req, [packet.order_id]) : new Map()
	res.json({ packet: serialisePacket(packet, packet.order_id ? orders.get(packet.order_id) : null) })
}
