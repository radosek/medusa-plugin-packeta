import { MedusaError } from "@medusajs/framework/utils"
import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { createOrderFulfillmentWorkflow, useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { num } from "../providers/packeta/lib/packet"
import { isPacketaShippingMethod, type PacketaAdditionalData } from "../providers/packeta/types"
import { recordPacketWorkflow } from "./record-packet"

export interface CreatePacketForOrderWorkflowInput {
	order_id: string
	/** Line items to fulfil; defaults to everything not yet fulfilled. */
	items?: { id: string; quantity: number }[]
	packeta?: PacketaAdditionalData
	created_by?: string
	no_notification?: boolean
}

type OrderRow = {
	id: string
	items: {
		id: string
		quantity?: unknown
		detail?: { quantity?: unknown; fulfilled_quantity?: unknown } | null
	}[]
	shipping_methods: {
		id: string
		shipping_option_id: string | null
		shipping_option?: { provider_id?: string | null } | null
		data?: Record<string, unknown> | null
	}[]
}

/**
 * Admin "Create Packeta packet": creates an order fulfillment for the Packeta
 * shipping method with `additional_data.packeta` (COD / weight / note
 * overrides), then mirrors it into `packeta_packet`.
 */
export const createPacketForOrderWorkflow = createWorkflow(
	"packeta-create-packet-for-order",
	(input: CreatePacketForOrderWorkflowInput) => {
		const orders = useQueryGraphStep({
			entity: "order",
			fields: [
				"id",
				"items.id",
				"items.quantity",
				"items.detail.quantity",
				"items.detail.fulfilled_quantity",
				"shipping_methods.id",
				"shipping_methods.shipping_option_id",
				"shipping_methods.data",
				"shipping_methods.shipping_option.provider_id",
			],
			filters: { id: input.order_id },
			options: { throwIfKeyNotFound: true },
		})

		const fulfillmentInput = transform({ orders, input }, ({ orders, input }) => {
			const order = (orders.data as OrderRow[])[0]
			const packetaMethod = (order.shipping_methods ?? []).find(isPacketaShippingMethod)
			if (!packetaMethod) {
				throw new MedusaError(MedusaError.Types.INVALID_DATA, "Order has no Packeta shipping method.")
			}
			const items =
				input.items && input.items.length
					? input.items
					: order.items
							.map((i) => ({
								id: i.id,
								// query.graph exposes the ordered quantity on `detail`, not on the item itself.
								quantity: num(i.detail?.quantity ?? i.quantity) - num(i.detail?.fulfilled_quantity ?? 0),
							}))
							.filter((i) => i.quantity > 0)
			if (!items.length) {
				throw new MedusaError(
					MedusaError.Types.INVALID_DATA,
					"All items of this order are already fulfilled.",
				)
			}
			return {
				order_id: input.order_id,
				items,
				created_by: input.created_by,
				no_notification: input.no_notification,
				additional_data: { packeta: input.packeta ?? {} },
			}
		})

		const fulfillment = createOrderFulfillmentWorkflow.runAsStep({ input: fulfillmentInput })

		const recordInput = transform({ fulfillment, input }, ({ fulfillment, input }) => ({
			fulfillment_id: fulfillment.id,
			order_id: input.order_id,
		}))
		const packet = recordPacketWorkflow.runAsStep({ input: recordInput })

		return new WorkflowResponse({ fulfillment, packet })
	},
)
