import packetaPollStatusJob from "#src/jobs/packeta-poll-status"
import { syncPacketStatus } from "#src/workflows/sync-packet-status"

jest.mock("#src/workflows/sync-packet-status", () => ({ syncPacketStatus: jest.fn() }))
const sync = syncPacketStatus as unknown as jest.Mock

const options = {
	poll_status: true,
	poll_status_cron: "* * * * *",
	poll_status_max_age_days: 30,
	poll_status_batch: 100,
	auto_ship_status_ids: [2, 3, 4, 5, 6, 12],
	auto_deliver_status_ids: [7],
}

function container(open: unknown[], owing: unknown[]) {
	const logger = { info: jest.fn(), warn: jest.fn() }
	const listPacketaPackets = jest.fn().mockResolvedValueOnce(open).mockResolvedValueOnce(owing)
	const packeta = { getOptions: () => options, listPacketaPackets }
	return {
		logger,
		listPacketaPackets,
		resolve: (k: string) => (k === "logger" ? logger : packeta),
	}
}

describe("packeta poll job", () => {
	beforeEach(() => sync.mockReset().mockResolvedValue({ decision: {} }))

	it("pulls open packets and terminal packets that still need a fulfillment update", async () => {
		const c = container([{ packet_id: "1", barcode: "Z1" }], [{ packet_id: "2", barcode: "Z2" }])
		await packetaPollStatusJob(c as any)
		expect(sync.mock.calls.map((call) => call[1].packet_id)).toEqual(["1", "2"])
		expect(c.listPacketaPackets.mock.calls[1][0]).toMatchObject({
			status_id: { $in: [7] },
			kind: { $ne: "return" },
			fulfillment_id: { $ne: null },
			$or: [{ shipped_marked_at: null }, { delivered_marked_at: null }],
		})
	})

	it("logs a failed fulfillment update and continues", async () => {
		const c = container([{ packet_id: "1", barcode: "Z1" }], [])
		sync.mockResolvedValue({ decision: {}, effectsError: new Error("lock timeout") })
		await packetaPollStatusJob(c as any)
		expect(c.logger.warn).toHaveBeenCalledWith(expect.stringContaining("lock timeout"))
		expect(c.logger.info).toHaveBeenCalledWith("Packeta poll: refreshed 1/1 packets")
	})
})
