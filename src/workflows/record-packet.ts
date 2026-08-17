import { createWorkflow, transform, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import { useQueryGraphStep } from "@medusajs/medusa/core-flows"
import { markCodCollectedStep } from "./steps/mark-cod-collected"
import { recordPacketStep } from "./steps/record-packet"

export interface RecordPacketWorkflowInput {
	fulfillment_id: string
	order_id?: string
}

/**
 * Mirror a freshly created (or updated) fulfillment into `packeta_packet`.
 * Runs from the `order.fulfillment_created` subscriber and after admin-created
 * packets. No-op for non-Packeta fulfillments.
 */
export const recordPacketWorkflow = createWorkflow(
	"packeta-record-packet",
	(input: RecordPacketWorkflowInput) => {
		const fulfillments = useQueryGraphStep({
			entity: "fulfillment",
			fields: ["id", "provider_id", "data", "canceled_at", "order.id", "labels.tracking_number"],
			filters: { id: input.fulfillment_id },
		})

		const stepInput = transform({ fulfillments, input }, ({ fulfillments, input }) => {
			const f = (
				fulfillments.data as {
					id: string
					provider_id: string
					data: Record<string, unknown> | null
					canceled_at: string | null
					order?: { id: string } | null
					labels?: { tracking_number?: string | null }[] | null
				}[]
			)[0]
			return {
				fulfillment_id: input.fulfillment_id,
				order_id: input.order_id ?? f?.order?.id ?? null,
				provider_id: f?.provider_id ?? null,
				data: f?.data ?? null,
				canceled_at: f?.canceled_at ?? null,
				labels: f?.labels ?? null,
			}
		})

		const packet = recordPacketStep(stepInput)
		markCodCollectedStep(
			transform({ packet, stepInput }, ({ packet, stepInput }) => ({
				order_id: stepInput.order_id,
				cod: Number((packet as { cod?: unknown } | null)?.cod ?? 0),
				barcode: String((packet as { barcode?: unknown } | null)?.barcode ?? ""),
			})),
		)
		return new WorkflowResponse(packet)
	},
)
