import { MedusaError } from "@medusajs/framework/utils"
import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { createOrderFulfillmentWorkflow, useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PACKETA_MODULE } from "../modules/packeta"
import type PacketaModuleService from "../modules/packeta/service"
import { num, round2 } from "../providers/packeta/lib/packet"
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
	display_id?: number | string
	custom_display_id?: string | null
	total?: unknown
	shipping_total?: unknown
	items: {
		id: string
		quantity?: unknown
		unit_price?: unknown
		detail?: { quantity?: unknown; fulfilled_quantity?: unknown } | null
	}[]
	shipping_methods: {
		id: string
		shipping_option_id: string | null
		shipping_option?: { provider_id?: string | null } | null
		data?: Record<string, unknown> | null
	}[]
}

/** Non-cancelled outbound packets already created for the order. */
const countOrderPacketsStep = createStep<{ order_id: string }, number, null>(
	"packeta-count-order-packets",
	async ({ order_id }, { container }) => {
		const service = container.resolve<PacketaModuleService>(PACKETA_MODULE)
		const [, count] = await service.listAndCountPacketaPackets(
			{ order_id, cancelled_at: null, kind: ["pickup", "hd"] },
			{ take: 1 },
		)
		return new StepResponse(count, null)
	},
)

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
				"display_id",
				"custom_display_id",
				"total",
				"shipping_total",
				"items.id",
				"items.unit_price",
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

		const existing = countOrderPacketsStep({ order_id: input.order_id })

		const fulfillmentInput = transform({ orders, input, existing }, (d) => {
			const { orders: ordersResult, input: wfInput, existing: existingCount } = d
			const order = (ordersResult.data as OrderRow[])[0]
			const packetaMethod = (order.shipping_methods ?? []).find(isPacketaShippingMethod)
			if (!packetaMethod) {
				throw new MedusaError(MedusaError.Types.INVALID_DATA, "Order has no Packeta shipping method.")
			}
			const items =
				wfInput.items && wfInput.items.length
					? wfInput.items
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
			// Split shipments: insure each packet for what it carries (shipping on the
			// first one), and give follow-up packets a distinct reference. COD stays on
			// the first packet only — see recordPacketWorkflow / markCodCollectedStep.
			const byId = new Map(order.items.map((i) => [i.id, i]))
			const linesValue = items.reduce((sum, it) => sum + num(byId.get(it.id)?.unit_price) * it.quantity, 0)
			const first = existingCount === 0
			const packeta = { ...wfInput.packeta }
			if (packeta.value == null)
				packeta.value = round2(linesValue + (first ? num(order.shipping_total) : 0)) || undefined
			if (packeta.number == null && !first) {
				packeta.number = `${packeta.number_prefix ?? ""}${order.custom_display_id ?? order.display_id ?? order.id}-${existingCount + 1}`
			}
			return {
				order_id: wfInput.order_id,
				items,
				created_by: wfInput.created_by,
				no_notification: wfInput.no_notification,
				additional_data: { packeta },
			}
		})

		const fulfillment = createOrderFulfillmentWorkflow.runAsStep({ input: fulfillmentInput })

		const recordInput = transform({ fulfillment, input }, (d) => ({
			fulfillment_id: d.fulfillment.id,
			order_id: d.input.order_id,
		}))
		const packet = recordPacketWorkflow.runAsStep({ input: recordInput })

		return new WorkflowResponse({ fulfillment, packet })
	},
)
