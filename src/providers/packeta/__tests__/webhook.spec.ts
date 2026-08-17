import { signPacketaWebhook, verifyPacketaSignature } from "../../../api/lib/webhook"
import { statusGroup, statusMeta } from "../lib/status"

describe("push tracking signature", () => {
	const key = "signing-key-from-packeta"
	const body = JSON.stringify({
		status: {
			eventId: "e1",
			id: 1234567890,
			barcode: "Z1234567890",
			dateTime: "2016-07-25T12:00:00",
			statusId: 2,
			statusCode: "arrived",
			statusText: "x",
		},
	})
	const ts = "1749837600"

	it("accepts a valid signature over `${timestamp}.${rawBody}`", () => {
		const sig = signPacketaWebhook(key, ts, body)
		expect(verifyPacketaSignature(key, ts, sig, body)).toBe(true)
		expect(verifyPacketaSignature(key, ts, sig.toUpperCase(), Buffer.from(body))).toBe(true)
	})

	it("rejects tampering, wrong key, wrong timestamp and missing headers", () => {
		const sig = signPacketaWebhook(key, ts, body)
		expect(verifyPacketaSignature(key, ts, sig, body.replace("arrived", "delivered"))).toBe(false)
		expect(verifyPacketaSignature("other", ts, sig, body)).toBe(false)
		expect(verifyPacketaSignature(key, "1", sig, body)).toBe(false)
		expect(verifyPacketaSignature(key, undefined, sig, body)).toBe(false)
		expect(verifyPacketaSignature(key, ts, undefined, body)).toBe(false)
		expect(verifyPacketaSignature(key, ts, "abc", body)).toBe(false)
	})
})

describe("status mapping", () => {
	it("maps known ids to groups and unknown ids to unknown", () => {
		expect(statusGroup(1)).toBe("created")
		expect(statusGroup(2)).toBe("in_transit")
		expect(statusGroup(5)).toBe("ready_for_pickup")
		expect(statusGroup(7)).toBe("delivered")
		expect(statusGroup(9)).toBe("returning")
		expect(statusGroup(10)).toBe("returned")
		expect(statusGroup(11)).toBe("cancelled")
		expect(statusGroup(16)).toBe("problem")
		expect(statusGroup(4242)).toBe("unknown")
		expect(statusMeta(4242).label).toBe("Status 4242")
		expect(statusMeta(null).group).toBe("unknown")
	})
})
