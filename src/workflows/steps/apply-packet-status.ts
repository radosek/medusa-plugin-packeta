import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { createStep, StepResponse } from "@medusajs/framework/workflows-sdk"
import { PACKETA_MODULE } from "../../modules/packeta"
import type PacketaModuleService from "../../modules/packeta/service"
import { statusGroup } from "../../providers/packeta/lib/status"
import type { CurrentStatusRecord, PacketaPushEvent } from "../../providers/packeta/types"

/** Statuses after which a packet's Packeta status never moves again. */
const TERMINAL_STATUS_IDS = new Set([7, 10, 11])

export interface ApplyPacketStatusInput {
	packet_id: string
	/** Push-tracking event; when omitted the status is pulled via `packetStatus`. */
	event?: PacketaPushEvent
	/** `X-Webhook-Event-Id`, used for dedupe. */
	event_id?: string
}

export interface PacketStatusDecision {
	packet_record_id: string
	packet_id: string
	kind: "pickup" | "hd" | "return"
	fulfillment_id: string | null
	order_id: string | null
	status_id: number | null
	changed: boolean
	ship: boolean
	deliver: boolean
	items: { id: string; quantity: number }[]
	labels: { tracking_number: string; tracking_url: string; label_url: string }[]
}

type Prev = { id: string; fields: Record<string, unknown> }

/**
 * Persist a Packeta status onto the packet record and decide which Medusa
 * side effects (mark shipped / delivered) the workflow should run.
 */
export const applyPacketStatusStep = createStep<ApplyPacketStatusInput, PacketStatusDecision, Prev | null>(
	"packeta-apply-packet-status",
	async (input, { container }) => {
		const service = container.resolve<PacketaModuleService>(PACKETA_MODULE)
		const query = container.resolve(ContainerRegistrationKeys.QUERY)
		const options = service.getOptions()

		const [record] = await service.listPacketaPackets({ packet_id: input.packet_id }, { take: 1 })
		if (!record) {
			throw new MedusaError(
				MedusaError.Types.NOT_FOUND,
				`Packeta packet ${input.packet_id} is not known to this store.`,
			)
		}
		if (input.event_id && record.last_event_id === input.event_id) {
			return new StepResponse(noop(record), null)
		}

		let status: CurrentStatusRecord | undefined
		let externalText: string | undefined
		let externalCode: string | undefined
		let statusId: number | null = record.status_id ?? null
		let statusText = record.status_text ?? null
		let statusCode = record.status_code ?? null
		let statusAt: Date | null = record.status_at ?? null

		if (input.event && "status" in input.event) {
			const s = input.event.status
			statusId = Number(s.statusId)
			statusCode = s.statusCode
			statusText = s.statusText
			statusAt = parseDate(s.dateTime)
			externalCode = s.externalTrackingCode ?? undefined
		} else if (input.event && "externalStatus" in input.event) {
			const s = input.event.externalStatus
			externalText = s.externalStatusText ?? undefined
			externalCode = s.externalTrackingCode ?? undefined
			statusAt = parseDate(s.dateTime) ?? statusAt
		} else {
			status = await service.getClient().packetStatus(input.packet_id)
			statusId = status.statusCode
			statusCode = status.codeText
			statusText = status.statusText
			statusAt = parseDate(status.dateTime)
			externalCode = status.externalTrackingCode ?? undefined
		}

		const previous: Prev = {
			id: record.id,
			fields: {
				status_id: record.status_id,
				status_code: record.status_code,
				status_text: record.status_text,
				status_at: record.status_at,
				external_tracking_code: record.external_tracking_code,
				external_status_text: record.external_status_text,
				is_returning: record.is_returning,
				stored_until: record.stored_until,
				last_event_id: record.last_event_id,
				cancelled_at: record.cancelled_at,
				raw: record.raw,
			},
		}

		// Never let a late/replayed event move a delivered/returned/cancelled packet
		// back to an earlier state (Packeta retries out of order; webhooks can be replayed).
		if (
			record.status_id != null &&
			TERMINAL_STATUS_IDS.has(record.status_id) &&
			statusId != null &&
			!TERMINAL_STATUS_IDS.has(statusId)
		) {
			if (input.event_id) await service.updatePacketaPackets({ id: record.id, last_event_id: input.event_id })
			return new StepResponse(noop(record), null)
		}

		const cancelledNow = statusId === 11 && !record.cancelled_at
		await service.updatePacketaPackets({
			id: record.id,
			status_id: statusId,
			status_code: statusCode,
			status_text: statusText,
			status_at: statusAt,
			external_tracking_code: externalCode ?? record.external_tracking_code ?? null,
			external_status_text: externalText ?? record.external_status_text ?? null,
			is_returning:
				status?.isReturning ??
				(statusId != null && ["returning", "returned"].includes(statusGroup(statusId))
					? true
					: record.is_returning),
			stored_until: status?.storedUntil ?? record.stored_until ?? null,
			last_event_id: input.event_id ?? record.last_event_id ?? null,
			cancelled_at: cancelledNow ? (statusAt ?? new Date()) : record.cancelled_at,
			raw:
				(input.event as unknown as Record<string, unknown> | undefined) ??
				(status as unknown as Record<string, unknown> | undefined) ??
				record.raw ??
				null,
		})

		const decision: PacketStatusDecision = {
			packet_record_id: record.id,
			packet_id: record.packet_id,
			kind: record.kind,
			fulfillment_id: record.fulfillment_id ?? null,
			order_id: record.order_id ?? null,
			status_id: statusId,
			changed: statusId !== record.status_id,
			ship: false,
			deliver: false,
			items: [],
			labels: [
				{
					tracking_number: record.barcode,
					tracking_url: record.tracking_url ?? "",
					label_url: `/admin/packeta/packets/${encodeURIComponent(record.packet_id)}/label`,
				},
			],
		}

		if (record.kind !== "return" && record.fulfillment_id && record.order_id && statusId != null) {
			const wantsShip =
				options.auto_ship_status_ids.includes(statusId) || options.auto_deliver_status_ids.includes(statusId)
			const wantsDeliver = options.auto_deliver_status_ids.includes(statusId)
			if ((wantsShip && !record.shipped_marked_at) || (wantsDeliver && !record.delivered_marked_at)) {
				const { data } = await query.graph({
					entity: "fulfillment",
					fields: ["id", "shipped_at", "delivered_at", "canceled_at", "items.line_item_id", "items.quantity"],
					filters: { id: record.fulfillment_id },
				})
				const f = data[0] as
					| {
							shipped_at: string | null
							delivered_at: string | null
							canceled_at: string | null
							items: { line_item_id: string; quantity: number }[]
					  }
					| undefined
				if (f && !f.canceled_at) {
					decision.items = (f.items ?? [])
						.filter((i) => i.line_item_id)
						.map((i) => ({ id: i.line_item_id, quantity: Number(i.quantity) }))
					decision.ship = wantsShip && !record.shipped_marked_at && !f.shipped_at && decision.items.length > 0
					decision.deliver = wantsDeliver && !record.delivered_marked_at && !f.delivered_at
				}
			}
		}

		return new StepResponse(decision, previous)
	},
	async (previous, { container }) => {
		if (!previous) return
		const service = container.resolve<PacketaModuleService>(PACKETA_MODULE)
		await service.updatePacketaPackets({ id: previous.id, ...previous.fields })
	},
)

function noop(record: {
	id: string
	packet_id: string
	kind: "pickup" | "hd" | "return"
	fulfillment_id: string | null
	order_id: string | null
	status_id: number | null
}): PacketStatusDecision {
	return {
		packet_record_id: record.id,
		packet_id: record.packet_id,
		kind: record.kind,
		fulfillment_id: record.fulfillment_id,
		order_id: record.order_id,
		status_id: record.status_id,
		changed: false,
		ship: false,
		deliver: false,
		items: [],
		labels: [],
	}
}

function parseDate(s: string | undefined | null): Date | null {
	if (!s) return null
	const d = new Date(s)
	return Number.isNaN(d.getTime()) ? null : d
}
