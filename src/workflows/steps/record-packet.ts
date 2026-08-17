import type { IFulfillmentModuleService } from "@medusajs/framework/types"
import { Modules } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PACKETA_MODULE } from "../../modules/packeta"
import type PacketaModuleService from "../../modules/packeta/service"
import { isPacketaProviderId, type PacketaPacketData } from "../../providers/packeta/types"

export interface RecordPacketStepInput {
	fulfillment_id: string
	order_id?: string | null
	provider_id?: string | null
	data?: Record<string, unknown> | null
	canceled_at?: string | Date | null
	labels?: { tracking_number?: string | null }[] | null
}

type PacketRow = Record<string, unknown> & { id: string }
type Compensation = { id: string; created?: boolean; previous?: PacketRow } | null

/** Upsert the `packeta_packet` row mirroring a fulfillment's Packeta data. */
export const recordPacketStep = createStep<RecordPacketStepInput, PacketRow | null, Compensation>(
	"packeta-record-packet",
	async (input, { container }) => {
		if (!isPacketaProviderId(input.provider_id)) return new StepResponse(null, null)
		const d = (input.data ?? {}) as Partial<PacketaPacketData>
		if (!d.packet_id) return new StepResponse(null, null)

		const service = container.resolve<PacketaModuleService>(PACKETA_MODULE)
		await ensureLabel(container, input, d)
		const [existing] = await service.listPacketaPackets({ packet_id: d.packet_id }, { take: 1 })
		const row = {
			packet_id: d.packet_id,
			barcode: d.barcode ?? `Z${d.packet_id}`,
			kind: d.kind ?? "pickup",
			fulfillment_id: input.fulfillment_id,
			order_id: input.order_id ?? null,
			number: d.number ?? null,
			cod: d.cod ?? 0,
			currency: d.currency ?? null,
			value: d.value ?? 0,
			weight_kg: d.weight_kg ?? null,
			carrier_id: d.carrier_id ?? null,
			point: (d.point as Record<string, unknown> | undefined) ?? null,
			address: (d.address as Record<string, unknown> | undefined) ?? null,
			tracking_url: d.tracking_url ?? null,
			password: d.password ?? null,
			cancelled_at: input.canceled_at
				? new Date(input.canceled_at)
				: d.cancelled_at
					? new Date(d.cancelled_at)
					: null,
		}
		if (existing) {
			const updated = (await service.updatePacketaPackets({
				id: existing.id,
				...row,
			})) as unknown as PacketRow
			return new StepResponse(updated, { id: existing.id, previous: existing as unknown as PacketRow })
		}
		try {
			const created = (await service.createPacketaPackets({
				...row,
				status_id: 1,
				status_code: "received data",
			})) as unknown as PacketRow
			return new StepResponse(created, { id: created.id, created: true })
		} catch (e) {
			// The subscriber and the admin workflow can race on the same fulfillment;
			// the unique index on packet_id makes the loser fall through to an update.
			if (!isUniqueViolation(e)) throw e
			const [raced] = await service.listPacketaPackets({ packet_id: d.packet_id }, { take: 1 })
			if (!raced) throw e
			const updated = (await service.updatePacketaPackets({ id: raced.id, ...row })) as unknown as PacketRow
			return new StepResponse(updated, { id: raced.id, previous: raced as unknown as PacketRow })
		}
	},
	async (compensation, { container }) => {
		if (!compensation) return
		const service = container.resolve<PacketaModuleService>(PACKETA_MODULE)
		if (compensation.created) {
			await service.deletePacketaPackets(compensation.id)
		} else if (compensation.previous) {
			const { id, created_at: _c, updated_at: _u, deleted_at: _d, ...prev } = compensation.previous
			await service.updatePacketaPackets({ id, ...prev })
		}
	},
)

/**
 * `createFulfillment` returns tracking labels, but the Fulfillment Module's
 * post-provider `update({ labels })` does not persist them (Medusa 2.19), so
 * put the tracking number on the fulfillment here where the public
 * `updateFulfillment` API handles label upserts. Best effort.
 */
async function ensureLabel(
	container: { resolve: <T>(key: string) => T },
	input: RecordPacketStepInput,
	d: Partial<PacketaPacketData>,
): Promise<void> {
	if (!d.barcode) return
	if (input.labels?.some((l) => l.tracking_number === d.barcode)) return
	try {
		const fulfillmentModule = container.resolve<IFulfillmentModuleService>(Modules.FULFILLMENT)
		await fulfillmentModule.updateFulfillment(input.fulfillment_id, {
			labels: [
				{
					tracking_number: d.barcode,
					tracking_url: d.tracking_url ?? "",
					label_url: `/admin/packeta/packets/${encodeURIComponent(d.packet_id ?? "")}/label`,
				},
			],
		})
	} catch (e) {
		const logger = container.resolve<{ warn: (m: string) => void }>("logger")
		logger.warn(
			`Packeta: could not attach tracking label to fulfillment ${input.fulfillment_id}: ${(e as Error).message}`,
		)
	}
}

function isUniqueViolation(e: unknown): boolean {
	const err = e as { code?: string; message?: string; cause?: { code?: string } }
	const code = err?.code ?? err?.cause?.code
	return code === "23505" || /unique|duplicate key/i.test(err?.message ?? "")
}
