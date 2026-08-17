import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"
import type { IOrderModuleService } from "@medusajs/framework/types"
import { createStep, createWorkflow, StepResponse, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { PACKETA_MODULE } from "../modules/packeta"
import type PacketaModuleService from "../modules/packeta/service"
import { isPacketaShippingMethod } from "../providers/packeta/types"

export interface FlagCodOrderWorkflowInput {
	order_id: string
}

export interface FlagCodResult {
	order_id: string
	flagged: boolean
	payment_providers: string[]
}

type OrderRow = {
	id: string
	metadata: Record<string, unknown> | null
	shipping_methods: {
		shipping_option?: { provider_id?: string | null } | null
		data?: Record<string, unknown> | null
	}[]
	payment_collections: {
		payments?: { provider_id?: string | null }[] | null
		payment_sessions?: { provider_id?: string | null; status?: string | null }[] | null
	}[]
}

/**
 * The fulfillment provider never sees payment data (its container has no
 * `query`), so decide COD here, right after the order is placed, and leave a
 * marker in `order.metadata.packeta_cod` that `createFulfillment` reads.
 */
const flagCodOrderStep = createStep<
	FlagCodOrderWorkflowInput,
	FlagCodResult,
	{ order_id: string; metadata: Record<string, unknown> | null } | null
>(
	"packeta-flag-cod-order",
	async (input, { container }) => {
		const packeta = container.resolve<PacketaModuleService>(PACKETA_MODULE)
		const query = container.resolve(ContainerRegistrationKeys.QUERY)
		const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
		const codProviders = new Set(packeta.getOptions().cod_payment_providers)

		const { data } = await query.graph({
			entity: "order",
			fields: [
				"id",
				"metadata",
				"shipping_methods.data",
				"shipping_methods.shipping_option.provider_id",
				"payment_collections.payments.provider_id",
				"payment_collections.payment_sessions.provider_id",
				"payment_collections.payment_sessions.status",
			],
			filters: { id: input.order_id },
		})
		const order = data[0] as OrderRow | undefined
		if (!order)
			return new StepResponse({ order_id: input.order_id, flagged: false, payment_providers: [] }, null)

		const hasPacketa = (order.shipping_methods ?? []).some(isPacketaShippingMethod)
		const providers = new Set<string>()
		for (const pc of order.payment_collections ?? []) {
			for (const p of pc.payments ?? []) if (p.provider_id) providers.add(p.provider_id)
			for (const s of pc.payment_sessions ?? [])
				if (s.provider_id && s.status !== "canceled") providers.add(s.provider_id)
		}
		const isCod = [...providers].some((p) => codProviders.has(p))
		if (!hasPacketa || !isCod || order.metadata?.packeta_cod === true) {
			return new StepResponse({ order_id: order.id, flagged: false, payment_providers: [...providers] }, null)
		}

		await orderModule.updateOrders([{ id: order.id, metadata: { ...order.metadata, packeta_cod: true } }])
		return new StepResponse(
			{ order_id: order.id, flagged: true, payment_providers: [...providers] },
			{ order_id: order.id, metadata: order.metadata },
		)
	},
	async (prev, { container }) => {
		if (!prev) return
		const orderModule = container.resolve<IOrderModuleService>(Modules.ORDER)
		await orderModule.updateOrders([{ id: prev.order_id, metadata: prev.metadata ?? {} }])
	},
)

export const flagCodOrderWorkflow = createWorkflow(
	"packeta-flag-cod-order",
	(input: FlagCodOrderWorkflowInput) => {
		return new WorkflowResponse(flagCodOrderStep(input))
	},
)
