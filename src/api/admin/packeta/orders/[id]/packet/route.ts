import type { AuthenticatedMedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import type { PacketaAdditionalData } from "../../../../../../providers/packeta/types"
import { createPacketForOrderWorkflow } from "../../../../../../workflows/create-packet-for-order"
import { findPacket, findPacketByFulfillment, ordersById, serialisePacket } from "../../../../../lib/packets"

type Body = {
	items?: { id: string; quantity: number }[]
	cod?: boolean
	cod_amount?: number
	weight_kg?: number
	note?: string
	number?: string
	deliver_on?: string
	adult_content?: boolean
	size?: { length: number; width: number; height: number }
	no_notification?: boolean
}

/** POST /admin/packeta/orders/:id/packet — create the Packeta fulfillment for an order with optional overrides. */
export const POST = async (req: AuthenticatedMedusaRequest<Body>, res: MedusaResponse) => {
	const b = (req.body ?? {}) as Body
	const packeta: PacketaAdditionalData = {}
	if (typeof b.cod === "boolean") packeta.cod = b.cod
	if (b.cod_amount != null) {
		const n = Number(b.cod_amount)
		if (!Number.isFinite(n) || n < 0)
			throw new MedusaError(MedusaError.Types.INVALID_DATA, "`cod_amount` must be a non-negative number")
		packeta.cod_amount = n
	}
	if (b.weight_kg != null) {
		const n = Number(b.weight_kg)
		if (!Number.isFinite(n) || n <= 0)
			throw new MedusaError(MedusaError.Types.INVALID_DATA, "`weight_kg` must be a positive number")
		packeta.weight_kg = n
	}
	if (b.note) packeta.note = String(b.note)
	if (b.number) packeta.number = String(b.number)
	if (b.deliver_on) packeta.deliver_on = String(b.deliver_on)
	if (typeof b.adult_content === "boolean") packeta.adult_content = b.adult_content
	if (b.size)
		packeta.size = {
			length: Number(b.size.length),
			width: Number(b.size.width),
			height: Number(b.size.height),
		}

	const items = Array.isArray(b.items)
		? b.items
				.map((i) => ({ id: String(i.id), quantity: Number(i.quantity) }))
				.filter((i) => i.id && i.quantity > 0)
		: undefined

	const { result } = await createPacketForOrderWorkflow(req.scope).run({
		input: {
			order_id: req.params.id,
			items,
			packeta,
			created_by: req.auth_context?.actor_id,
			no_notification: b.no_notification,
		},
	})
	// The workflow's fulfillment DTO is serialised before the provider result is
	// persisted, so read the packet back through our own record instead.
	const packetId =
		(result.packet as { packet_id?: string } | null | undefined)?.packet_id ??
		(result.fulfillment?.data as { packet_id?: string } | undefined)?.packet_id
	const packet = packetId
		? await findPacket(req, packetId)
		: await findPacketByFulfillment(req, result.fulfillment?.id)
	const orders = packet?.order_id ? await ordersById(req, [packet.order_id]) : new Map()
	res.status(201).json({
		fulfillment: result.fulfillment,
		packet: packet ? serialisePacket(packet, packet.order_id ? orders.get(packet.order_id) : null) : null,
	})
}
