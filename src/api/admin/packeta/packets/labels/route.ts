import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PACKETA_MODULE } from "../../../../../modules/packeta"
import type PacketaModuleService from "../../../../../modules/packeta/service"
import { toMedusaError } from "../../../../../providers/packeta/service"
import { labelFormat, sendPdf } from "../../../../lib/packets"

/** POST /admin/packeta/packets/labels { packet_ids: string[], format?, offset? } → one PDF with all labels. */
export const POST = async (
	req: MedusaRequest<{ packet_ids?: unknown; format?: unknown; offset?: unknown }>,
	res: MedusaResponse,
) => {
	const packeta = req.scope.resolve<PacketaModuleService>(PACKETA_MODULE)
	const raw = Array.isArray(req.body?.packet_ids) ? req.body.packet_ids : []
	const ids = raw.map((v) => String(v).replace(/^Z/i, "").trim()).filter(Boolean)
	if (!ids.length)
		throw new MedusaError(MedusaError.Types.INVALID_DATA, "`packet_ids` must be a non-empty array")
	if (ids.length > 200)
		throw new MedusaError(MedusaError.Types.INVALID_DATA, "At most 200 labels per request")
	const format = labelFormat(req, packeta.getOptions().label_format)
	const offset = Number(req.body?.offset ?? 0) || 0
	let base64: string
	try {
		base64 = await packeta.getClient().packetsLabelsPdf(ids, format, offset)
	} catch (e) {
		throw toMedusaError(e)
	}
	sendPdf(res, base64, `packeta-labels-${ids.length}.pdf`, "attachment")
}
