import { MedusaError } from "@medusajs/framework/utils"
import { POST } from "../../../api/hooks/packeta/route"
import { signPacketaWebhook } from "../../../api/lib/webhook"
import { syncPacketStatusWorkflow } from "../../../workflows/sync-packet-status"

jest.mock("../../../workflows/sync-packet-status", () => ({ syncPacketStatusWorkflow: jest.fn() }))
const runSync = jest.fn()
;(syncPacketStatusWorkflow as unknown as jest.Mock).mockReturnValue({ run: runSync })

const KEY = "k"
const body = JSON.stringify({
	status: {
		eventId: "e",
		id: 1,
		barcode: "Z1",
		dateTime: "2026-01-01T00:00:00",
		statusId: 2,
		statusCode: "arrived",
		statusText: "x",
	},
})

function req(headers: Record<string, string>, options: Record<string, unknown>) {
	const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn() }
	const scope = {
		resolve: (k: string) =>
			k === "logger"
				? logger
				: { getOptions: () => ({ webhook_tolerance_s: 300, allow_unsigned_webhook: false, ...options }) },
	}
	return { headers, body: JSON.parse(body), rawBody: body, scope, logger } as any
}
function res() {
	const r: any = {
		statusCode: 0,
		body: null,
		status(c: number) {
			r.statusCode = c
			return r
		},
		json(b: unknown) {
			r.body = b
			return r
		},
	}
	return r
}

describe("webhook route auth", () => {
	const nodeEnv = process.env.NODE_ENV
	afterEach(() => {
		process.env.NODE_ENV = nodeEnv
	})

	it("rejects a stale timestamp even with a valid signature", async () => {
		const ts = String(Math.floor(Date.now() / 1000) - 3600)
		const r = res()
		await POST(
			req(
				{ "x-webhook-timestamp": ts, "x-webhook-signature": signPacketaWebhook(KEY, ts, body) },
				{ webhook_signing_key: KEY },
			),
			r,
		)
		expect(r.statusCode).toBe(401)
	})

	it("rejects a bad signature", async () => {
		const ts = String(Math.floor(Date.now() / 1000))
		const r = res()
		await POST(
			req({ "x-webhook-timestamp": ts, "x-webhook-signature": "00" }, { webhook_signing_key: KEY }),
			r,
		)
		expect(r.statusCode).toBe(401)
	})

	it("refuses unsigned webhooks without a key, and ignores allow_unsigned_webhook in production", async () => {
		const r1 = res()
		await POST(req({}, {}), r1)
		expect(r1.statusCode).toBe(503)
		process.env.NODE_ENV = "production"
		const r2 = res()
		await POST(req({}, { allow_unsigned_webhook: true }), r2)
		expect(r2.statusCode).toBe(503)
	})
})

const ts = () => String(Math.floor(Date.now() / 1000))

const signed = () => {
	const t = ts()
	return req(
		{ "x-webhook-timestamp": t, "x-webhook-signature": signPacketaWebhook(KEY, t, body) },
		{ webhook_signing_key: KEY },
	)
}

describe("webhook route status application", () => {
	beforeEach(() => runSync.mockReset())

	it("acks a valid event with 200", async () => {
		runSync.mockResolvedValue({})
		const r = res()
		await POST(signed(), r)
		expect(r.statusCode).toBe(200)
		expect(runSync).toHaveBeenCalledWith({ input: expect.objectContaining({ packet_id: "1" }) })
	})

	it("acks an unknown packet with 200 so Packeta stops retrying", async () => {
		// What a failed workflow step rethrows: a serialized MedusaError, not an instance.
		runSync.mockRejectedValue({ __isMedusaError: true, type: MedusaError.Types.NOT_FOUND, message: "nope" })
		const r = res()
		await POST(signed(), r)
		expect(r.statusCode).toBe(200)
	})

	it("acks a permanently invalid status with 200 and logs it", async () => {
		runSync.mockRejectedValue({ __isMedusaError: true, type: MedusaError.Types.INVALID_DATA, message: "bad" })
		const r = res()
		const q = signed()
		await POST(q, r)
		expect(r.statusCode).toBe(200)
		expect(q.logger.error).toHaveBeenCalled()
	})

	it("answers 500 when applying a known packet's status fails, so Packeta redelivers", async () => {
		runSync.mockRejectedValue(new Error("db down"))
		const r = res()
		const q = signed()
		await POST(q, r)
		expect(r.statusCode).toBe(500)
		expect(q.logger.error).toHaveBeenCalled()
	})
})
