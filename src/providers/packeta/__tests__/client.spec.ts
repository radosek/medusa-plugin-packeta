import { PacketaClient, PacketaError } from "../lib/client"

const PW = "0123456789abcdef0123456789abcdef"

function mockFetch(body: string, status = 200) {
	const fn = jest.fn(async () => new Response(body, { status, headers: { "Content-Type": "text/xml" } }))
	global.fetch = fn as unknown as typeof fetch
	return fn
}

const ok = (inner: string) =>
	`<?xml version="1.0"?><response><status>ok</status><result>${inner}</result></response>`
const fault = (name: string, msg: string, detail = "") =>
	`<?xml version="1.0"?><response><status>fault</status><fault>${name}</fault><string>${msg}</string>${detail ? `<detail>${detail}</detail>` : ""}</response>`

describe("PacketaClient", () => {
	const client = new PacketaClient({ api_password: PW })

	it("posts XML with the method as root and parses createPacket", async () => {
		const fetch = mockFetch(
			ok("<id>4154090000</id><barcode>Z4154090000</barcode><barcodeText>Z 415 4090 000</barcodeText>"),
		)
		const res = await client.createPacket({
			number: "1001",
			name: "Jan",
			surname: "Novák",
			email: "a@b.cz",
			addressId: "79",
			value: 100,
			weight: 1.2,
			eshop: "shop",
			currency: "CZK",
			cod: 0,
		})
		expect(res).toEqual({ id: "4154090000", barcode: "Z4154090000", barcodeText: "Z 415 4090 000" })
		const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit]
		expect(url).toBe("https://www.zasilkovna.cz/api/rest")
		expect(init.method).toBe("POST")
		expect(init.body).toMatch(
			/^<\?xml[^>]*><createPacket><apiPassword>0123456789abcdef0123456789abcdef<\/apiPassword><packetAttributes>/,
		)
		expect(init.body).toContain("<surname>Novák</surname>")
		expect(init.body).toContain("<weight>1.2</weight>")
		expect(init.body).toContain("<cod>0</cod>")
	})

	it("throws PacketaError with attribute details and redacts the password", async () => {
		mockFetch(
			fault(
				"PacketAttributesFault",
				`Failed to validate attributes ${PW}`,
				"<attributes><fault><name>zip</name><fault>Invalid ZIP</fault></fault><fault><name>phone</name><fault>Bad phone</fault></fault></attributes>",
			),
		)
		await expect(client.cancelPacket("1")).rejects.toMatchObject({
			name: "PacketaError",
			fault: "PacketAttributesFault",
			attributes: [
				{ name: "zip", fault: "Invalid ZIP" },
				{ name: "phone", fault: "Bad phone" },
			],
		})
		const err = (await client.cancelPacket("1").catch((e) => e)) as PacketaError
		expect(err.message).toContain("[REDACTED]")
		expect(err.message).not.toContain(PW)
		expect(err.message).toContain("zip: Invalid ZIP")
	})

	it("reads attribute faults regardless of element order and nesting", async () => {
		mockFetch(
			fault(
				"PacketAttributesFault",
				"x",
				"<attributes><fault><fault>Bad phone</fault><name>phone</name></fault></attributes>",
			),
		)
		await expect(client.cancelPacket("1")).rejects.toMatchObject({
			attributes: [{ name: "phone", fault: "Bad phone" }],
		})
		mockFetch(
			`<response><status>fault</status><fault>PacketIdsFault</fault><string>Invalid ids</string><detail><ids><id>1</id><id>2</id></ids></detail></response>`,
		)
		await expect(client.packetsLabelsPdf(["1", "2"], "A6 on A6")).rejects.toMatchObject({
			attributes: [
				{ name: "id", fault: "1" },
				{ name: "id", fault: "2" },
			],
		})
	})

	it("never mistakes a nested <id> for the packet id", async () => {
		mockFetch(
			ok(
				"<courierInfo><courierInfoItem><id>999</id></courierInfoItem></courierInfo><id>4154090000</id><barcode>Z4154090000</barcode>",
			),
		)
		await expect(
			client.createPacket({ number: "1", name: "A", surname: "B", addressId: "79", value: 1, weight: 1 }),
		).resolves.toMatchObject({ id: "4154090000" })
	})

	it("returns base64 label bodies verbatim", async () => {
		mockFetch(ok("\n  JVBERi0xLjQK  \n"))
		await expect(client.packetLabelPdf("1", "A6 on A6")).resolves.toBe("JVBERi0xLjQK")
	})

	it("parses packetStatus into a typed record", async () => {
		mockFetch(
			ok(
				"<dateTime>2025-01-02T03:04:05</dateTime><statusCode>5</statusCode><codeText>ready for pickup</codeText><statusText>Ready</statusText><branchId>79</branchId><destinationBranchId>0</destinationBranchId><isReturning>0</isReturning><storedUntil>2025-01-09</storedUntil><carrierId>106</carrierId>",
			),
		)
		const s = await client.packetStatus("1")
		expect(s).toMatchObject({
			statusCode: 5,
			codeText: "ready for pickup",
			branchId: 79,
			isReturning: false,
			storedUntil: "2025-01-09",
			carrierId: 106,
		})
	})

	it("parses packetTracking records", async () => {
		mockFetch(
			ok(
				"<record><dateTime>a</dateTime><statusCode>1</statusCode><codeText>received data</codeText><statusText>x</statusText></record><record><dateTime>b</dateTime><statusCode>2</statusCode><codeText>arrived</codeText><statusText>y</statusText><branchId>3</branchId></record>",
			),
		)
		const list = await client.packetTracking("1")
		expect(list.map((r) => r.statusCode)).toEqual([1, 2])
		expect(list[1].branchId).toBe(3)
	})

	it("parses createPacketClaimWithPassword", async () => {
		const fetch = mockFetch(
			ok("<id>99</id><barcode>Z99</barcode><barcodeText>Z 99</barcodeText><password>ABCD</password>"),
		)
		const res = await client.createPacketClaimWithPassword({
			number: "RET-1",
			email: "a@b.cz",
			value: 1,
			currency: "CZK",
			eshop: "shop",
			consignCountry: "cz",
			sendEmailToCustomer: true,
		})
		expect(res).toEqual({ id: "99", barcode: "Z99", barcodeText: "Z 99", password: "ABCD" })
		const body = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
		expect(body).toContain("<createPacketClaimWithPassword><apiPassword>")
		expect(body).toContain("<claimWithPasswordAttributes><number>RET-1</number>")
		expect(body).toContain("<sendEmailToCustomer>1</sendEmailToCustomer>")
	})

	it("surfaces non-XML HTTP failures as PacketaError", async () => {
		mockFetch("<html>Bad gateway</html>", 502)
		await expect(client.packetStatus("1")).rejects.toMatchObject({ name: "PacketaError", fault: "HTTP 502" })
	})
})
