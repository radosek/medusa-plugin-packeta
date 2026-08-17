import { createWorkflow, transform, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
	createOrderShipmentWorkflow,
	markOrderFulfillmentAsDeliveredWorkflow,
} from "@medusajs/medusa/core-flows"
import { applyPacketStatusStep, type ApplyPacketStatusInput } from "./steps/apply-packet-status"
import { markPacketFlagsStep } from "./steps/mark-packet-flags"

export type SyncPacketStatusWorkflowInput = ApplyPacketStatusInput

/**
 * Apply a Packeta status (pushed by the webhook or pulled on demand) to the
 * packet record and, for outbound packets, mark the Medusa fulfillment as
 * shipped / delivered according to `auto_ship_status_ids` /
 * `auto_deliver_status_ids`. Idempotent: replays and duplicate events are no-ops.
 */
export const syncPacketStatusWorkflow = createWorkflow(
	"packeta-sync-packet-status",
	(input: SyncPacketStatusWorkflowInput) => {
		const decision = applyPacketStatusStep(input)

		when("packeta-should-ship", decision, (d) => d.ship).then(() => {
			const shipInput = transform(decision, (d) => ({
				order_id: d.order_id as string,
				fulfillment_id: d.fulfillment_id as string,
				items: d.items,
				labels: d.labels,
				no_notification: false,
			}))
			createOrderShipmentWorkflow.runAsStep({ input: shipInput })
		})

		when("packeta-should-deliver", decision, (d) => d.deliver).then(() => {
			const deliverInput = transform(decision, (d) => ({
				orderId: d.order_id as string,
				fulfillmentId: d.fulfillment_id as string,
			}))
			markOrderFulfillmentAsDeliveredWorkflow.runAsStep({ input: deliverInput })
		})

		const flags = transform(decision, (d) => ({
			packet_record_id: d.packet_record_id,
			shipped: d.ship,
			delivered: d.deliver,
		}))
		markPacketFlagsStep(flags)

		return new WorkflowResponse(decision)
	},
)
