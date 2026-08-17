import { defineLink } from "@medusajs/framework/utils"
import OrderModule from "@medusajs/medusa/order"
import PacketaModule from "../modules/packeta"

/** `packeta_packet.order_id` → order (read-only, for `query.graph`). */
export default defineLink(
	{ linkable: PacketaModule.linkable.packetaPacket, field: "order_id" },
	OrderModule.linkable.order,
	{ readOnly: true },
)
