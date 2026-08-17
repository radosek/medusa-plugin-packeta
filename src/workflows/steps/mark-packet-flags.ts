import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PACKETA_MODULE } from "../../modules/packeta"
import type PacketaModuleService from "../../modules/packeta/service"

export interface MarkPacketFlagsInput {
	packet_record_id: string
	shipped?: boolean
	delivered?: boolean
	cancelled?: boolean
}

/** Remember which Medusa side effects already ran for a packet (idempotency). */
export const markPacketFlagsStep = createStep<MarkPacketFlagsInput, void, MarkPacketFlagsInput | null>(
	"packeta-mark-packet-flags",
	async (input, { container }) => {
		if (!input.shipped && !input.delivered && !input.cancelled) return new StepResponse(undefined, null)
		const service = container.resolve<PacketaModuleService>(PACKETA_MODULE)
		const now = new Date()
		await service.updatePacketaPackets({
			id: input.packet_record_id,
			...(input.shipped ? { shipped_marked_at: now } : {}),
			...(input.delivered ? { delivered_marked_at: now, shipped_marked_at: now } : {}),
			...(input.cancelled ? { cancelled_at: now } : {}),
		})
		return new StepResponse(undefined, input)
	},
	async (input, { container }) => {
		if (!input) return
		const service = container.resolve<PacketaModuleService>(PACKETA_MODULE)
		await service.updatePacketaPackets({
			id: input.packet_record_id,
			...(input.shipped ? { shipped_marked_at: null } : {}),
			...(input.delivered ? { delivered_marked_at: null } : {}),
			...(input.cancelled ? { cancelled_at: null } : {}),
		})
	},
)
