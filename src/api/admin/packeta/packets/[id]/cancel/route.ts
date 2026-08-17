import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { findPacket, ordersById, serialisePacket } from "../../../../../lib/packets"
import { cancelPacketWorkflow } from "../../../../../../workflows/cancel-packet"

/** POST /admin/packeta/packets/:id/cancel — cancel at Packeta (and the Medusa fulfillment for outbound packets). */
export const POST = async (req: AuthenticatedMedusaRequest, res: MedusaResponse) => {
	const packet = await findPacket(req, req.params.id)
	await cancelPacketWorkflow(req.scope).run({
		input: { packet_id: packet.packet_id, canceled_by: req.auth_context?.actor_id },
	})
	const fresh = await findPacket(req, packet.packet_id)
	const orders = fresh.order_id ? await ordersById(req, [fresh.order_id]) : new Map()
	res.json({ packet: serialisePacket(fresh, fresh.order_id ? orders.get(fresh.order_id) : null) })
}
