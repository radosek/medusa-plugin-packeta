import type { SubscriberArgs, SubscriberConfig } from "@medusajs/framework"
import { flagCodOrderWorkflow } from "../workflows/flag-cod-order"

/** Decide COD from the order's payment provider and flag it for the fulfillment provider. */
export default async function packetaOrderPlaced({
	event: { data },
	container,
}: SubscriberArgs<{ id: string }>) {
	const logger = container.resolve("logger")
	try {
		await flagCodOrderWorkflow(container).run({ input: { order_id: data.id } })
	} catch (e) {
		logger.error(`Packeta: COD flagging for order ${data.id} failed: ${(e as Error).message}`)
	}
}

export const config: SubscriberConfig = {
	event: "order.placed",
}
