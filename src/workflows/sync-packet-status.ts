import type { MedusaContainer } from "@medusajs/framework/types"
import { createWorkflow, transform, when, WorkflowResponse } from "@medusajs/framework/workflows-sdk"
import {
	createOrderShipmentWorkflow,
	markOrderFulfillmentAsDeliveredWorkflow,
} from "@medusajs/medusa/core-flows"
import {
	applyPacketStatusStep,
	type ApplyPacketStatusInput,
	type PacketStatusDecision,
} from "./steps/apply-packet-status"
import { markPacketFlagsStep } from "./steps/mark-packet-flags"

export type SyncPacketStatusWorkflowInput = ApplyPacketStatusInput

/** Persist a Packeta status onto the packet record and decide the Medusa side effects. */
export const applyPacketStatusWorkflow = createWorkflow(
	"packeta-apply-packet-status",
	(input: SyncPacketStatusWorkflowInput) => new WorkflowResponse(applyPacketStatusStep(input)),
)

/**
 * Mark the Medusa fulfillment as shipped / delivered according to a status decision.
 * Separate from `applyPacketStatusWorkflow` so a rejected side effect (cancelled order,
 * missing fulfillment) never rolls back the stored status.
 */
export const applyPacketEffectsWorkflow = createWorkflow(
	"packeta-apply-packet-effects",
	(decision: PacketStatusDecision) => {
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

/**
 * Apply a Packeta status (pushed by the webhook or pulled on demand) to the packet
 * record, then — for outbound packets — mark the fulfillment shipped / delivered per
 * `auto_ship_status_ids` / `auto_deliver_status_ids`, in that order.
 *
 * Throws when the status itself could not be applied (including `NOT_FOUND` for an
 * unknown packet). A side-effect failure does not throw: the status is already
 * stored, the error is returned as `effectsError`, and the shipped / delivered flags
 * stay unset so the next pull retries the side effect.
 */
export async function syncPacketStatus(
	container: MedusaContainer,
	input: SyncPacketStatusWorkflowInput,
): Promise<{ decision: PacketStatusDecision; effectsError?: unknown }> {
	const { result: decision } = await applyPacketStatusWorkflow(container).run({ input })
	if (!decision.ship && !decision.deliver) return { decision }
	try {
		await applyPacketEffectsWorkflow(container).run({ input: decision })
		return { decision }
	} catch (effectsError) {
		return { decision, effectsError }
	}
}

/**
 * Status and side effects in one workflow: a failing side effect also rolls back the
 * status. Kept for existing callers; the plugin's own routes and job use
 * `syncPacketStatus`, which keeps the status when a side effect is rejected.
 */
export const syncPacketStatusWorkflow = createWorkflow(
	"packeta-sync-packet-status",
	(input: SyncPacketStatusWorkflowInput) => {
		const decision = applyPacketStatusStep(input)
		const result = applyPacketEffectsWorkflow.runAsStep({ input: decision })
		return new WorkflowResponse(result)
	},
)
