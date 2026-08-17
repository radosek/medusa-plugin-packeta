import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { recordPacketWorkflow } from "../workflows/record-packet"

/** Mirror new Packeta fulfillments into `packeta_packet` (also covers fulfillments created from the native admin flow). */
export default async function packetaFulfillmentCreated({
	event: { data },
	container,
}: SubscriberArgs<{ order_id: string; fulfillment_id: string }>) {
	const logger = container.resolve("logger")
	try {
		await recordPacketWorkflow(container).run({
			input: { fulfillment_id: data.fulfillment_id, order_id: data.order_id },
		})
	} catch (e) {
		logger.error(
			`Packeta: recording packet for fulfillment ${data.fulfillment_id} failed: ${(e as Error).message}`,
		)
	}
}

export const config: SubscriberConfig = {
	event: "order.fulfillment_created",
}
