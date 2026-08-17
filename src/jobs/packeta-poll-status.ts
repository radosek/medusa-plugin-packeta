import type { MedusaContainer } from "@medusajs/framework/types"
import { PACKETA_MODULE } from "../modules/packeta"
import type PacketaModuleService from "../modules/packeta/service"
import { syncPacketStatusWorkflow } from "../workflows/sync-packet-status"

/** Terminal statuses that never change again — skip them. */
const TERMINAL = [7, 10, 11]

/**
 * Pull tracking for open packets. This is the fallback (and belt-and-braces)
 * for stores that have not enabled Packeta push tracking; harmless alongside
 * it since status application is idempotent. Runs on the configured cron; the
 * cron itself cannot be read from options at load time, so the schedule
 * below is the default and `poll_status` / `poll_status_cron` gate execution.
 */
export default async function packetaPollStatusJob(container: MedusaContainer) {
	const logger = container.resolve("logger")
	const packeta = container.resolve<PacketaModuleService>(PACKETA_MODULE)
	const options = packeta.getOptions()
	if (!options.poll_status) return
	if (!cronMatches(options.poll_status_cron, new Date())) return

	const since = new Date(Date.now() - options.poll_status_max_age_days * 86_400_000)
	const packets = await packeta.listPacketaPackets(
		{
			cancelled_at: null,
			created_at: { $gte: since },
			$or: [{ status_id: null }, { status_id: { $nin: TERMINAL } }],
		},
		{ take: options.poll_status_batch, order: { status_at: "ASC" } },
	)
	if (!packets.length) return

	let ok = 0
	for (const p of packets) {
		try {
			await syncPacketStatusWorkflow(container).run({ input: { packet_id: p.packet_id } })
			ok++
		} catch (e) {
			logger.warn(`Packeta poll: ${p.barcode} failed: ${(e as Error).message}`)
		}
	}
	logger.info(`Packeta poll: refreshed ${ok}/${packets.length} packets`)
}

export const config = {
	name: "packeta-poll-status",
	// Fires every minute; the job itself applies `poll_status_cron` (default every
	// 30 minutes) so any 5-field cron the merchant configures is honoured exactly.
	// The gate is a cheap in-memory check — no DB work on non-matching minutes.
	schedule: "* * * * *",
}

// Minimal 5-field cron matcher (minute hour dom month dow): star, star-slash-n, lists and ranges.
export function cronMatches(expr: string, date: Date): boolean {
	const parts = expr.trim().split(/\s+/)
	if (parts.length !== 5) return true
	const values = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()]
	return parts.every((field, i) => fieldMatches(field, values[i]))
}

function fieldMatches(field: string, value: number): boolean {
	return field.split(",").some((part) => {
		const [range, stepStr] = part.split("/")
		const step = stepStr ? Number(stepStr) : 1
		if (range === "*") return value % step === 0
		const [a, b] = range.split("-").map(Number)
		if (Number.isNaN(a)) return false
		if (b === undefined) return stepStr ? value >= a && (value - a) % step === 0 : value === a
		return value >= a && value <= b && (value - a) % step === 0
	})
}
