import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { ContainerRegistrationKeys, MedusaError } from "@medusajs/framework/utils"
import { PACKETA_MODULE } from "../../modules/packeta"
import type PacketaModuleService from "../../modules/packeta/service"
import { statusMeta } from "../../providers/packeta/lib/status"
import { PACKETA_LABEL_FORMATS, type PacketaLabelFormat } from "../../providers/packeta/types"

export type PacketRecord = Awaited<ReturnType<PacketaModuleService["listPacketaPackets"]>>[number]

export interface SerialisedPacket extends Record<string, unknown> {
	id: string
	packet_id: string
	barcode: string
	kind: string
	status: {
		id: number | null
		code: string | null
		text: string | null
		label: string
		group: string
		at: string | null
	}
	order?: { id: string; display_id?: number | string | null; email?: string | null } | null
	label_url: string
}

export function serialisePacket(p: PacketRecord, order?: SerialisedPacket["order"]): SerialisedPacket {
	const meta = statusMeta(p.status_id ?? null)
	return {
		id: p.id,
		packet_id: p.packet_id,
		barcode: p.barcode,
		kind: p.kind,
		number: p.number,
		fulfillment_id: p.fulfillment_id,
		order_id: p.order_id,
		status: {
			id: p.status_id ?? null,
			code: p.status_code ?? null,
			text: p.status_text ?? null,
			label: p.status_id != null ? meta.label : "Created",
			group: p.cancelled_at ? "cancelled" : p.status_id != null ? meta.group : "created",
			at: p.status_at ? new Date(p.status_at).toISOString() : null,
		},
		external_tracking_code: p.external_tracking_code,
		external_status_text: p.external_status_text,
		is_returning: p.is_returning,
		stored_until: p.stored_until,
		cod: Number(p.cod ?? 0),
		currency: p.currency,
		value: Number(p.value ?? 0),
		weight_kg: p.weight_kg,
		carrier_id: p.carrier_id,
		point: p.point,
		address: p.address,
		tracking_url: p.tracking_url,
		password: p.password,
		shipped_marked_at: p.shipped_marked_at,
		delivered_marked_at: p.delivered_marked_at,
		cancelled_at: p.cancelled_at,
		created_at: p.created_at,
		updated_at: p.updated_at,
		order: order ?? null,
		label_url: `/admin/packeta/packets/${encodeURIComponent(p.packet_id)}/label`,
	}
}

/** Resolve `:id` as either the Packeta packet id (digits / Z-prefixed) or the record id. */
export async function findPacket(req: MedusaRequest, id: string): Promise<PacketRecord> {
	const packeta = req.scope.resolve<PacketaModuleService>(PACKETA_MODULE)
	const bare = id.replace(/^Z/i, "")
	const [byPacketId] = await packeta.listPacketaPackets({ packet_id: bare }, { take: 1 })
	if (byPacketId) return byPacketId
	const [byId] = await packeta.listPacketaPackets({ id }, { take: 1 })
	if (byId) return byId
	throw new MedusaError(MedusaError.Types.NOT_FOUND, `Packeta packet ${id} not found`)
}

export async function findPacketByFulfillment(
	req: MedusaRequest,
	fulfillmentId: string | undefined,
): Promise<PacketRecord | null> {
	if (!fulfillmentId) return null
	const packeta = req.scope.resolve<PacketaModuleService>(PACKETA_MODULE)
	const [row] = await packeta.listPacketaPackets(
		{ fulfillment_id: fulfillmentId },
		{ take: 1, order: { created_at: "DESC" } },
	)
	return row ?? null
}

export async function ordersById(
	req: MedusaRequest,
	ids: string[],
): Promise<Map<string, SerialisedPacket["order"]>> {
	const unique = [...new Set(ids.filter(Boolean))]
	const map = new Map<string, SerialisedPacket["order"]>()
	if (!unique.length) return map
	const query = req.scope.resolve(ContainerRegistrationKeys.QUERY)
	const { data } = await query.graph({
		entity: "order",
		fields: ["id", "display_id", "email"],
		filters: { id: unique },
	})
	for (const o of data as { id: string; display_id?: number; email?: string }[])
		map.set(o.id, { id: o.id, display_id: o.display_id, email: o.email })
	return map
}

export function labelFormat(req: MedusaRequest, fallback: PacketaLabelFormat): PacketaLabelFormat {
	const q =
		(req.query as Record<string, unknown>).format ?? (req.body as Record<string, unknown> | undefined)?.format
	if (!q) return fallback
	const f = String(q)
	if (!PACKETA_LABEL_FORMATS.includes(f as PacketaLabelFormat)) {
		throw new MedusaError(
			MedusaError.Types.INVALID_DATA,
			`Unknown label format "${f}". Use one of: ${PACKETA_LABEL_FORMATS.join(", ")}`,
		)
	}
	return f as PacketaLabelFormat
}

export function sendPdf(
	res: MedusaResponse,
	base64: string,
	filename: string,
	disposition: "inline" | "attachment" = "inline",
): void {
	const buf = Buffer.from(base64, "base64")
	res.setHeader("Content-Type", "application/pdf")
	res.setHeader("Content-Length", String(buf.length))
	res.setHeader("Content-Disposition", `${disposition}; filename="${filename}"`)
	res.setHeader("Cache-Control", "private, no-store")
	res.status(200).send(buf)
}

export function str(v: unknown): string | undefined {
	if (v === undefined || v === null) return undefined
	const s = String(v).trim()
	return s ? s : undefined
}

export function int(v: unknown, dflt: number, max?: number): number {
	const n = Number.parseInt(String(v ?? ""), 10)
	if (!Number.isFinite(n) || n < 0) return dflt
	return max != null ? Math.min(n, max) : n
}
