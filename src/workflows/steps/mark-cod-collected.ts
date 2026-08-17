import type { IOrderModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"

export interface MarkCodCollectedInput {
	order_id: string | null
	cod: number
	barcode: string
}

/**
 * Once a COD packet exists for an order, flip `metadata.packeta_cod` from `true`
 * to `"collected"` so any further packet for the same order (split shipment,
 * native partial fulfillment) is created without COD — the customer must pay
 * the order once, not per packet.
 */
export const markCodCollectedStep = createStep<
	MarkCodCollectedInput,
	boolean,
	{ order_id: string; metadata: Record<string, unknown> } | null
>(
	"packeta-mark-cod-collected",
	async (input, { container }) => {
		if (!input.order_id || !(input.cod > 0)) return new StepResponse(false, null)
		const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
		const order = await orderModule.retrieveOrder(input.order_id, { select: ["id", "metadata"] })
		const meta = (order.metadata ?? {}) as Record<string, unknown>
		if (meta.packeta_cod === "collected") return new StepResponse(false, null)
		await orderModule.updateOrders([
			{ id: order.id, metadata: { ...meta, packeta_cod: "collected", packeta_cod_barcode: input.barcode } },
		])
		return new StepResponse(true, { order_id: order.id, metadata: meta })
	},
	async (prev, { container }) => {
		if (!prev) return
		const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
		await orderModule.updateOrders([{ id: prev.order_id, metadata: prev.metadata }])
	},
)
