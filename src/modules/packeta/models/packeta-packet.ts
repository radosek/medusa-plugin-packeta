import { model } from "@medusajs/framework/utils"

/**
 * One row per Packeta packet (outbound or return claim) created through the
 * plugin. Mirrors `fulfillment.data` so the admin can list/filter packets and
 * the webhook can find a fulfillment by packet id without scanning JSON.
 */
const PacketaPacket = model
	.define("packeta_packet", {
		id: model.id({ prefix: "pkta" }).primaryKey(),
		packet_id: model.text().unique(),
		barcode: model.text(),
		kind: model.enum(["pickup", "hd", "return"]),
		fulfillment_id: model.text().nullable(),
		order_id: model.text().nullable(),
		number: model.text().nullable(),
		status_id: model.number().nullable(),
		status_code: model.text().nullable(),
		status_text: model.text().nullable(),
		status_at: model.dateTime().nullable(),
		external_tracking_code: model.text().nullable(),
		external_status_text: model.text().nullable(),
		is_returning: model.boolean().default(false),
		stored_until: model.text().nullable(),
		cod: model.bigNumber().default(0),
		currency: model.text().nullable(),
		value: model.bigNumber().default(0),
		weight_kg: model.float().nullable(),
		carrier_id: model.text().nullable(),
		point: model.json().nullable(),
		address: model.json().nullable(),
		tracking_url: model.text().nullable(),
		password: model.text().nullable(),
		last_event_id: model.text().nullable(),
		shipped_marked_at: model.dateTime().nullable(),
		delivered_marked_at: model.dateTime().nullable(),
		cancelled_at: model.dateTime().nullable(),
		raw: model.json().nullable(),
	})
	.indexes([
		{ on: ["fulfillment_id"], where: "deleted_at IS NULL" },
		{ on: ["order_id"], where: "deleted_at IS NULL" },
		{ on: ["status_id"], where: "deleted_at IS NULL" },
	])

export default PacketaPacket
