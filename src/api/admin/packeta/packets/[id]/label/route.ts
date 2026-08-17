import type { MedusaRequest, MedusaResponse } from "@medusajs/framework/http"
import { MedusaError } from "@medusajs/framework/utils"
import { PACKETA_MODULE } from "../../../../../../modules/packeta"
import type PacketaModuleService from "../../../../../../modules/packeta/service"
import { toMedusaError } from "../../../../../../providers/packeta/service"
import type { PacketaZplDpi } from "../../../../../../providers/packeta/types"
import { findPacket, labelFormat, sendPdf } from "../../../../../lib/packets"

/**
 * GET /admin/packeta/packets/:id/label
 *   ?type=pdf (default) | zpl | carrier | carrier-zpl
 *   ?format=A6%20on%20A6   (pdf; Packeta label formats)
 *   ?dpi=203|300           (zpl)
 *   ?download=1
 * `carrier*` fetches the external carrier's own label (carrier must be apiAllowed).
 */
export const GET = async (req: MedusaRequest, res: MedusaResponse) => {
	const packeta = req.scope.resolve<PacketaModuleService>(PACKETA_MODULE)
	const packet = await findPacket(req, req.params.id)
	const q = req.query as Record<string, unknown>
	const type = String(q.type ?? "pdf")
	const download = ["1", "true"].includes(String(q.download ?? ""))
	const dpi = (Number(q.dpi ?? 203) === 300 ? 300 : 203) as PacketaZplDpi
	const client = packeta.getClient()

	try {
		switch (type) {
			case "pdf": {
				const base64 = await client.packetLabelPdf(
					packet.packet_id,
					labelFormat(req, packeta.getOptions().label_format),
				)
				sendPdf(res, base64, `packeta-${packet.barcode}.pdf`, download ? "attachment" : "inline")
				return
			}
			case "zpl": {
				const zpl = await client.packetLabelZpl(packet.packet_id, dpi)
				sendText(res, zpl, `packeta-${packet.barcode}.zpl`, download)
				return
			}
			case "carrier": {
				const { courierNumber } = await client.packetCourierNumberV2(packet.packet_id)
				const base64 = await client.packetCourierLabelPdf(packet.packet_id, courierNumber)
				sendPdf(res, base64, `packeta-${packet.barcode}-carrier.pdf`, download ? "attachment" : "inline")
				return
			}
			case "carrier-zpl": {
				const { courierNumber } = await client.packetCourierNumberV2(packet.packet_id)
				const zpl = await client.packetCourierLabelZpl(packet.packet_id, courierNumber, dpi)
				sendText(res, zpl, `packeta-${packet.barcode}-carrier.zpl`, download)
				return
			}
			default:
				throw new MedusaError(
					MedusaError.Types.INVALID_DATA,
					`Unknown label type "${type}" (pdf | zpl | carrier | carrier-zpl)`,
				)
		}
	} catch (e) {
		throw toMedusaError(e)
	}
}

function sendText(res: MedusaResponse, body: string, filename: string, download: boolean): void {
	res.setHeader("Content-Type", "text/plain; charset=utf-8")
	res.setHeader("Content-Disposition", `${download ? "attachment" : "inline"}; filename="${filename}"`)
	res.setHeader("Cache-Control", "private, no-store")
	res.status(200).send(body)
}
