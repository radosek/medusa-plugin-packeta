import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import {
	createStep,
	createWorkflow,
	StepResponse,
	transform,
	when,
	WorkflowResponse,
} from "@medusajs/framework/workflows-sdk"
import { cancelOrderFulfillmentWorkflow } from "@medusajs/medusa/core-flows"
import { PACKETA_MODULE } from "../modules/packeta"
import type PacketaModuleService from "../modules/packeta/service"
import { PacketaError } from "../providers/packeta/lib/client"
import { markPacketFlagsStep } from "./steps/mark-packet-flags"

export interface CancelPacketWorkflowInput {
	packet_id: string
	canceled_by?: string
}

interface CancelPlan {
	packet_record_id: string
	kind: "pickup" | "hd" | "return"
	order_id: string | null
	fulfillment_id: string | null
	/** true → run cancelOrderFulfillmentWorkflow (which cancels at Packeta via the provider) */
	cancel_fulfillment: boolean
	/** true → cancelled directly at Packeta in this step */
	cancelled_directly: boolean
}

const planCancelStep = createStep<CancelPacketWorkflowInput, CancelPlan, null>(
	"packeta-plan-cancel",
	async (input, { container }) => {
		const service = container.resolve<PacketaModuleService>(PACKETA_MODULE)
		const query = container.resolve(ContainerRegistrationKeys.QUERY)
		const [record] = await service.listPacketaPackets({ packet_id: input.packet_id }, { take: 1 })
		if (!record)
			throw new MedusaError(MedusaError.Types.NOT_FOUND, `Packeta packet ${input.packet_id} not found.`)
		if (record.cancelled_at) {
			return new StepResponse(
				{
					packet_record_id: record.id,
					kind: record.kind,
					order_id: record.order_id ?? null,
					fulfillment_id: record.fulfillment_id ?? null,
					cancel_fulfillment: false,
					cancelled_directly: false,
				},
				null,
			)
		}

		let fulfillment: { id: string; canceled_at: string | null; shipped_at: string | null } | undefined
		if (record.fulfillment_id) {
			const { data } = await query.graph({
				entity: "fulfillment",
				fields: ["id", "canceled_at", "shipped_at"],
				filters: { id: record.fulfillment_id },
			})
			fulfillment = data[0] as typeof fulfillment
		}

		// Outbound packet with a live order fulfillment: let Medusa drive it so the
		// order's fulfillment state stays consistent (the provider cancels at Packeta).
		if (record.kind !== "return" && record.order_id && fulfillment && !fulfillment.canceled_at) {
			if (fulfillment.shipped_at) {
				throw new MedusaError(
					MedusaError.Types.NOT_ALLOWED,
					"Fulfillment is already shipped; the packet can no longer be cancelled.",
				)
			}
			return new StepResponse(
				{
					packet_record_id: record.id,
					kind: record.kind,
					order_id: record.order_id,
					fulfillment_id: fulfillment.id,
					cancel_fulfillment: true,
					cancelled_directly: false,
				},
				null,
			)
		}

		// Return claims, or orphaned records: cancel straight at Packeta.
		try {
			await service.getClient().cancelPacket(record.packet_id)
		} catch (e) {
			if (!(e instanceof PacketaError && e.fault === "PacketIdFault")) {
				throw new MedusaError(MedusaError.Types.NOT_ALLOWED, (e as Error).message)
			}
		}
		return new StepResponse(
			{
				packet_record_id: record.id,
				kind: record.kind,
				order_id: record.order_id ?? null,
				fulfillment_id: record.fulfillment_id ?? null,
				cancel_fulfillment: false,
				cancelled_directly: true,
			},
			null,
		)
	},
)

/** Cancel a packet at Packeta and, for outbound packets, the Medusa fulfillment. */
export const cancelPacketWorkflow = createWorkflow(
	"packeta-cancel-packet",
	(input: CancelPacketWorkflowInput) => {
		const plan = planCancelStep(input)

		when("packeta-cancel-fulfillment", plan, (p) => p.cancel_fulfillment).then(() => {
			const cancelInput = transform({ plan, input }, (d) => ({
				order_id: d.plan.order_id as string,
				fulfillment_id: d.plan.fulfillment_id as string,
				canceled_by: d.input.canceled_by,
			}))
			cancelOrderFulfillmentWorkflow.runAsStep({ input: cancelInput })
		})

		markPacketFlagsStep(
			transform(plan, (p) => ({
				packet_record_id: p.packet_record_id,
				cancelled: p.cancel_fulfillment || p.cancelled_directly,
			})),
		)
		return new WorkflowResponse(plan)
	},
)
