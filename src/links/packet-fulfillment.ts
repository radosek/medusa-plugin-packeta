import { defineLink } from "@medusajs/framework/utils"
import FulfillmentModule from "@medusajs/medusa/fulfillment"
import PacketaModule from "../modules/packeta"

/** `packeta_packet.fulfillment_id` → fulfillment (read-only, for `query.graph`). */
export default defineLink(
	{ linkable: PacketaModule.linkable.packetaPacket, field: "fulfillment_id" },
	FulfillmentModule.linkable.fulfillment,
	{ readOnly: true },
)
