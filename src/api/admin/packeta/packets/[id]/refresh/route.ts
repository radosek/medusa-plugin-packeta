import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { findPacket, ordersById, serialisePacket } from "../../../../../lib/packets"
import { syncPacketStatusWorkflow } from "../../../../../../workflows/sync-packet-status"

/** POST /admin/packeta/packets/:id/refresh — pull the current status from Packeta and apply it. */
export const POST = async (req: MedusaRequest, res: MedusaResponse) => {
	const packet = await findPacket(req, req.params.id)
	await syncPacketStatusWorkflow(req.scope).run({ input: { packet_id: packet.packet_id } })
	const fresh = await findPacket(req, packet.packet_id)
	const orders = fresh.order_id ? await ordersById(req, [fresh.order_id]) : new Map()
	res.json({ packet: serialisePacket(fresh, fresh.order_id ? orders.get(fresh.order_id) : null) })
}
