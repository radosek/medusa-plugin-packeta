import { PacketaClient } from "../lib/client"
import { buildCustoms, buildPacketAttributes } from "../lib/packet"
import { resolveOptions, type PacketaCarrier, type PacketaFulfillmentData } from "../types"
import { cronMatches } from "../../../jobs/packeta-poll-status"

const options = resolveOptions({
	api_password: "x".repeat(32),
	api_key: "k".repeat(16),
	eshop: "shop",
	default_size: { length: 300, width: 200, height: 100 },
	customs: { default_hs_code: "61091000", default_origin_country: "cz", invoice_number: "INV-{display_id}" },
})

const carrierCH: PacketaCarrier = {
	id: "4",
	name: "CH Post HD",
	available: true,
	pickupPoints: false,
	apiAllowed: true,
	separateHouseNumber: false,
	customsDeclarations: true,
	requiresEmail: true,
	requiresPhone: true,
	requiresSize: true,
	disallowsCod: true,
	country: "ch",
	currency: "CHF",
	maxWeight: 30,
}

const order = {
	id: "order_1",
	display_id: 77,
	email: "a@b.cz",
	currency_code: "eur",
	total: 120,
	shipping_total: 9.9,
	shipping_address: {
		first_name: "A",
		last_name: "B",
		address_1: "Viktoriapl. 1",
		city: "Bern",
		postal_code: "3013",
		country_code: "ch",
		phone: "+41791234567",
	},
	items: [
		{
			id: "li_1",
			title: "Tee M",
			product_title: "Tee",
			unit_price: 50,
			quantity: 2,
			variant: { weight: 200, hs_code: "61091000", origin_country: "PT" },
		},
		{ id: "li_2", title: "Cap", unit_price: 20, quantity: 1, variant: { weight: null } },
	],
} as any

const items = [
	{ line_item_id: "li_1", quantity: 2 },
	{ line_item_id: "li_2", quantity: 1 },
]

describe("customs + size", () => {
	it("adds size from options and customs items from order lines for customs carriers", () => {
		const data: PacketaFulfillmentData = { kind: "hd", option_id: "packeta-carrier-4", carrier_id: "4" }
		const b = buildPacketAttributes({ order, items, data, options, carrier: carrierCH, fallbackNumber: "f" })
		expect(b.attributes.size).toEqual({ length: 300, width: 200, height: 100 })
		expect(b.attributes.attributes).toEqual(
			expect.arrayContaining([
				{ key: "ead", value: "carrier" },
				{ key: "deliveryCost", value: 9.9 },
				{ key: "invoiceNumber", value: "INV-77" },
			]),
		)
		expect(b.attributes.items).toHaveLength(2)
		const first = Object.fromEntries(b.attributes.items![0].map((a) => [a.key, a.value]))
		expect(first).toMatchObject({
			customsCode: "61091000",
			countryOfOrigin: "PT",
			productNameEn: "Tee",
			value: 100,
			unitsCount: 2,
			weight: 0.4,
		})
		const second = Object.fromEntries(b.attributes.items![1].map((a) => [a.key, a.value]))
		expect(second).toMatchObject({ customsCode: "61091000", countryOfOrigin: "CZ", value: 20, unitsCount: 1 })
		expect(Number(second.weight)).toBeGreaterThan(0)
	})

	it("lets explicit customs data win", () => {
		const data: PacketaFulfillmentData = { kind: "hd", option_id: "packeta-home-delivery", carrier_id: "106" }
		const c = buildCustoms(
			{
				order,
				items,
				data,
				options,
				additional: {
					customs: { ead: "create", invoiceFile: "31759" },
					customs_items: [[{ key: "customsCode", value: "1" }]],
				},
				fallbackNumber: "f",
			},
			"EUR",
			1,
		)
		expect(c.attributes).toEqual(
			expect.arrayContaining([
				{ key: "ead", value: "create" },
				{ key: "invoiceFile", value: "31759" },
			]),
		)
		expect(c.items).toEqual([[{ key: "customsCode", value: "1" }]])
	})

	it("serialises attributes/items/size to XML", async () => {
		const fetch = jest.fn(
			async () =>
				new Response(
					"<response><status>ok</status><result><id>1</id><barcode>Z1</barcode></result></response>",
				),
		)
		global.fetch = fetch as unknown as typeof fetch
		const client = new PacketaClient({ api_password: "x".repeat(32) })
		await client.createPacket({
			number: "1",
			name: "A",
			surname: "B",
			addressId: "4",
			value: 1,
			weight: 1,
			size: { length: 1, width: 2, height: 3 },
			attributes: [{ key: "ead", value: "carrier" }],
			items: [
				[
					{ key: "customsCode", value: "1" },
					{ key: "isFoodBook", value: false },
				],
			],
		})
		const body = (fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string
		expect(body).toContain("<size><length>1</length><width>2</width><height>3</height></size>")
		expect(body).toContain(
			"<attributes><attribute><key>ead</key><value>carrier</value></attribute></attributes>",
		)
		expect(body).toContain(
			"<items><item><attributes><attribute><key>customsCode</key><value>1</value></attribute><attribute><key>isFoodBook</key><value>0</value></attribute></attributes></item></items>",
		)
	})

	it("fetches ZPL and carrier labels", async () => {
		const calls: string[] = []
		global.fetch = jest.fn(async (_u: string, init: RequestInit) => {
			calls.push(init.body as string)
			if ((init.body as string).includes("<packetCourierNumberV2>"))
				return new Response(
					"<response><status>ok</status><result><courierNumber>ABC</courierNumber><carrierId>4</carrierId></result></response>",
				)
			if ((init.body as string).includes("<packetLabelZpl>"))
				return new Response("<response><status>ok</status><result>^XA&lt;test&gt;^XZ</result></response>")
			return new Response("<response><status>ok</status><result>JVBERi0=</result></response>")
		}) as unknown as typeof fetch
		const client = new PacketaClient({ api_password: "x".repeat(32) })
		expect(await client.packetLabelZpl("1", 300)).toBe("^XA<test>^XZ")
		expect(calls[0]).toContain("<dpi>300</dpi>")
		expect(await client.packetCourierNumberV2("1")).toEqual({
			courierNumber: "ABC",
			carrierId: 4,
			carrierName: undefined,
		})
		expect(await client.packetCourierLabelPdf("1", "ABC")).toBe("JVBERi0=")
		expect(calls[2]).toContain("<courierNumber>ABC</courierNumber>")
	})
})

describe("cronMatches", () => {
	const d = (h: number, m: number) => new Date(2026, 0, 5, h, m) // Monday
	it("handles star, step, list, range", () => {
		expect(cronMatches("*/30 * * * *", d(10, 0))).toBe(true)
		expect(cronMatches("*/30 * * * *", d(10, 30))).toBe(true)
		expect(cronMatches("*/30 * * * *", d(10, 15))).toBe(false)
		expect(cronMatches("0 6-18 * * 1-5", d(9, 0))).toBe(true)
		expect(cronMatches("0 6-18 * * 1-5", d(20, 0))).toBe(false)
		expect(cronMatches("0,20,40 * * * *", d(1, 20))).toBe(true)
		expect(cronMatches("garbage", d(1, 1))).toBe(true)
	})
})
