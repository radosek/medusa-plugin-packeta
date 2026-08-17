import PacketaProviderService from "../service"

const PW = "0123456789abcdef0123456789abcdef"
const KEY = "abcdefghijklmnop"

const carriers = [
	{
		id: "106",
		name: "CZ Zásilkovna domů HD",
		available: "true",
		pickupPoints: "false",
		country: "cz",
		currency: "CZK",
		maxWeight: "30",
	},
	{
		id: "131",
		name: "SK Packeta Home HD",
		available: "true",
		pickupPoints: "false",
		country: "sk",
		currency: "EUR",
		maxWeight: "30",
	},
	{
		id: "3060",
		name: "PL InPost Paczkomaty",
		available: "true",
		pickupPoints: "true",
		country: "pl",
		currency: "PLN",
		maxWeight: "25",
		disallowsCod: "true",
	},
	{ id: "1", name: "Unavailable", available: "false", pickupPoints: "false", country: "cz", currency: "CZK" },
]

type Call = { url: string; init: RequestInit }
let calls: Call[]

function installFetch(handlers: Record<string, (init: RequestInit) => Response | Promise<Response>>) {
	calls = []
	global.fetch = jest.fn(async (url: string, init: RequestInit) => {
		calls.push({ url, init })
		for (const [k, h] of Object.entries(handlers)) if (url.includes(k)) return h(init)
		return new Response("not mocked", { status: 599 })
	}) as unknown as typeof fetch
}

const okXml = (inner: string) =>
	new Response(`<response><status>ok</status><result>${inner}</result></response>`)
const faultXml = (fault: string, msg: string) =>
	new Response(`<response><status>fault</status><fault>${fault}</fault><string>${msg}</string></response>`)

const logger = { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }

function service(extra: Record<string, unknown> = {}) {
	return new PacketaProviderService(
		{ logger: logger as never },
		{ api_password: PW, api_key: KEY, eshop: "shop", ...extra },
	)
}

const ctx = (country = "cz") =>
	({
		id: "cart_1",
		shipping_address: {
			first_name: "Jan",
			last_name: "Novák",
			address_1: "Hlavní 1",
			city: "Praha",
			postal_code: "11000",
			country_code: country,
			phone: "+420777123456",
		},
		items: [],
		from_location: {},
	}) as never

const order = {
	id: "order_1",
	display_id: 7,
	email: "jan@example.com",
	currency_code: "czk",
	total: 500,
	metadata: {},
	shipping_address: {
		first_name: "Jan",
		last_name: "Novák",
		phone: "+420777123456",
		address_1: "Hlavní 1",
		city: "Praha",
		postal_code: "11000",
		country_code: "cz",
	},
	items: [],
} as never

describe("PacketaProviderService", () => {
	beforeEach(() => {
		installFetch({
			"/carrier/json": () => new Response(JSON.stringify(carriers)),
			"widget/v1/validate": () =>
				new Response(
					JSON.stringify({
						isValid: true,
						point: {
							name: "Z-BOX Praha",
							address: { street: "Hlavní 1", city: "Praha", zip: "110 00", country: "cz" },
							group: "zbox",
						},
						errors: [],
					}),
				),
			"api/rest": () =>
				okXml("<id>4154090000</id><barcode>Z4154090000</barcode><barcodeText>Z 415 4090 000</barcodeText>"),
		})
	})

	describe("options", () => {
		it("rejects missing or malformed credentials", () => {
			expect(() =>
				PacketaProviderService.validateOptions({ api_password: "", api_key: KEY, eshop: "s" }),
			).toThrow(/api_password/)
			expect(() =>
				PacketaProviderService.validateOptions({ api_password: KEY, api_key: KEY, eshop: "s" }),
			).toThrow(/32-character/)
			expect(() =>
				PacketaProviderService.validateOptions({ api_password: PW, api_key: "", eshop: "s" }),
			).toThrow(/api_key/)
			expect(() =>
				PacketaProviderService.validateOptions({ api_password: PW, api_key: KEY, eshop: "" }),
			).toThrow(/eshop/)
			expect(() =>
				PacketaProviderService.validateOptions({
					api_password: PW,
					api_key: KEY,
					eshop: "s",
					label_format: "A3" as never,
				}),
			).toThrow(/label_format/)
			expect(() =>
				PacketaProviderService.validateOptions({ api_password: PW, api_key: KEY, eshop: "s" }),
			).not.toThrow()
		})
	})

	describe("getFulfillmentOptions", () => {
		it("returns static options plus available feed carriers", async () => {
			const opts = await service().getFulfillmentOptions()
			expect(opts.map((o) => o.id)).toEqual([
				"packeta-pickup",
				"packeta-home-delivery",
				"packeta-return",
				"packeta-carrier-106",
				"packeta-carrier-131",
				"packeta-carrier-3060",
			])
			expect(opts.find((o) => o.id === "packeta-return")?.is_return).toBe(true)
			expect(opts.find((o) => o.id === "packeta-carrier-3060")).toMatchObject({
				carrier_id: "3060",
				pickup_points: true,
				disallows_cod: true,
				country: "pl",
			})
		})

		it("honours enabled_carriers and expose_carriers", async () => {
			expect((await service({ enabled_carriers: ["131"] }).getFulfillmentOptions()).map((o) => o.id)).toEqual(
				["packeta-pickup", "packeta-home-delivery", "packeta-return", "packeta-carrier-131"],
			)
			expect((await service({ expose_carriers: false }).getFulfillmentOptions()).map((o) => o.id)).toEqual([
				"packeta-pickup",
				"packeta-home-delivery",
				"packeta-return",
			])
		})

		it("degrades to static options when the feed is down", async () => {
			installFetch({ "/carrier/json": () => new Response("nope", { status: 500 }) })
			const opts = await service().getFulfillmentOptions()
			expect(opts).toHaveLength(3)
			expect(logger.warn).toHaveBeenCalled()
		})

		it("validates option ids", async () => {
			const s = service()
			await expect(s.validateOption({ id: "packeta-pickup" })).resolves.toBe(true)
			await expect(s.validateOption({ id: "packeta-carrier-106" })).resolves.toBe(true)
			await expect(s.validateOption({ id: "dhl" })).resolves.toBe(false)
			await expect(s.canCalculate({} as never)).resolves.toBe(false)
		})
	})

	describe("validateFulfillmentData", () => {
		it("normalises an internal pickup point and validates it server-side", async () => {
			const out = await service().validateFulfillmentData(
				{ id: "packeta-pickup" },
				{ point_id: "79", point: { name: "Praha 4", country: "CZ" }, note: "ring twice" },
				ctx(),
			)
			expect(out).toMatchObject({
				kind: "pickup",
				option_id: "packeta-pickup",
				point_id: "79",
				note: "ring twice",
			})
			expect(out.point).toMatchObject({
				id: "79",
				name: "Praha 4",
				country: "cz",
				street: "Hlavní 1",
				city: "Praha",
				zip: "110 00",
				group: "zbox",
				type: "internal",
			})
			const v = calls.find((c) => c.url.includes("validate"))!
			expect(JSON.parse(v.init.body as string)).toEqual({ apiKey: KEY, point: { id: "79" }, options: {} })
		})

		it("normalises an external carrier point", async () => {
			const out = await service().validateFulfillmentData(
				{ id: "packeta-carrier-3060", carrier_id: "3060", pickup_points: true },
				{
					point: {
						carrierId: "3060",
						carrierPickupPointId: "BIA10M",
						pickupPointType: "external",
						name: "Paczkomat",
					},
				},
				ctx("pl"),
			)
			expect(out).toMatchObject({
				kind: "pickup",
				carrier_id: "3060",
				carrier_pickup_point_id: "BIA10M",
				point_id: undefined,
			})
			expect(out.point?.type).toBe("external")
			const v = calls.find((c) => c.url.includes("validate"))!
			expect(JSON.parse(v.init.body as string)).toEqual({
				apiKey: KEY,
				point: { carrierId: "3060", carrierPickupPointId: "BIA10M" },
				options: { carriers: "3060" },
			})
		})

		it("rejects a point from another carrier on a carrier-specific option", async () => {
			await expect(
				service().validateFulfillmentData(
					{ id: "packeta-carrier-3060", carrier_id: "3060", pickup_points: true },
					{ point_id: "79" },
					ctx(),
				),
			).rejects.toThrow(/does not belong to carrier/)
		})

		it("rejects an invalid selection reported by Packeta", async () => {
			installFetch({
				"/carrier/json": () => new Response(JSON.stringify(carriers)),
				"widget/v1/validate": () =>
					new Response(
						JSON.stringify({
							isValid: false,
							errors: [{ code: "PickupPointIsFull", description: "The PUDO point is full." }],
						}),
					),
			})
			await expect(
				service().validateFulfillmentData({ id: "packeta-pickup" }, { point_id: "79" }, ctx()),
			).rejects.toThrow(/PUDO point is full/)
		})

		it("accepts the selection when validation is disabled or unreachable", async () => {
			const noValidate = await service({ validate_pickup_point: false }).validateFulfillmentData(
				{ id: "packeta-pickup" },
				{ point_id: "79" },
				ctx(),
			)
			expect(noValidate.point_id).toBe("79")
			expect(calls.some((c) => c.url.includes("validate"))).toBe(false)

			installFetch({
				"/carrier/json": () => new Response(JSON.stringify(carriers)),
				"widget/v1/validate": () => new Response("boom", { status: 500 }),
			})
			const out = await service().validateFulfillmentData({ id: "packeta-pickup" }, { point_id: "79" }, ctx())
			expect(out.point_id).toBe("79")
			expect(logger.warn).toHaveBeenCalled()
		})

		it("requires a point for pickup", async () => {
			await expect(service().validateFulfillmentData({ id: "packeta-pickup" }, {}, ctx())).rejects.toThrow(
				/point_id/,
			)
		})

		it("resolves the HD carrier from the shipping country", async () => {
			const out = await service().validateFulfillmentData({ id: "packeta-home-delivery" }, {}, ctx("SK"))
			expect(out).toMatchObject({ kind: "hd", carrier_id: "131" })
		})

		it("uses the option carrier for carrier-specific HD and keeps the widget address", async () => {
			const out = await service().validateFulfillmentData(
				{ id: "packeta-carrier-106", carrier_id: "106", pickup_points: false },
				{
					address: {
						street: "Vinohradská",
						houseNumber: "1",
						city: "Praha",
						postcode: "120 00",
						country: "CZ",
					},
				},
				ctx(),
			)
			expect(out).toMatchObject({
				kind: "hd",
				carrier_id: "106",
				address: { street: "Vinohradská", house_number: "1", city: "Praha", zip: "12000", country: "cz" },
			})
		})

		it("fails HD when no carrier serves the country", async () => {
			await expect(
				service().validateFulfillmentData({ id: "packeta-home-delivery" }, {}, ctx("us")),
			).rejects.toThrow(/no home-delivery carrier/)
		})
	})

	describe("createFulfillment", () => {
		it("creates a packet and returns tracking + label info", async () => {
			const res = await service().createFulfillment(
				{ kind: "pickup", option_id: "packeta-pickup", point_id: "79", point: { name: "Praha 4" } },
				[],
				order,
				{ id: "ful_1" },
			)
			expect(res.data).toMatchObject({
				packet_id: "4154090000",
				barcode: "Z4154090000",
				number: "7",
				cod: 0,
				currency: "CZK",
				value: 500,
				weight_kg: 0.5,
				kind: "pickup",
			})
			expect(res.labels).toEqual([
				{
					tracking_number: "Z4154090000",
					tracking_url: "https://tracking.packeta.com/cs/?id=Z4154090000",
					label_url: "/admin/packeta/packets/4154090000/label",
				},
			])
			const body = calls.find((c) => c.url.includes("api/rest"))!.init.body as string
			expect(body).toContain("<addressId>79</addressId>")
			expect(body).toContain("<eshop>shop</eshop>")
		})

		it("applies additional_data (COD, note) and rejects COD on carriers that disallow it", async () => {
			await service().createFulfillment(
				{ kind: "pickup", option_id: "packeta-pickup", point_id: "79" },
				[],
				order,
				{ id: "ful_1" },
				{ cod: true, note: "hi" },
			)
			const body = calls.find((c) => c.url.includes("api/rest"))!.init.body as string
			expect(body).toContain("<cod>500</cod>")
			expect(body).toContain("<note>hi</note>")

			await expect(
				service().createFulfillment(
					{
						kind: "pickup",
						option_id: "packeta-carrier-3060",
						carrier_id: "3060",
						carrier_pickup_point_id: "X",
					},
					[],
					order,
					{ id: "ful_1" },
					{ cod: true },
				),
			).rejects.toThrow(/does not allow cash on delivery/)
		})

		it("requires dimensions for size-requiring carriers unless default_size is set", async () => {
			const data = {
				kind: "pickup",
				option_id: "packeta-carrier-3060",
				carrier_id: "3060",
				carrier_pickup_point_id: "X",
			}
			installFetch({
				"/carrier/json": () =>
					new Response(JSON.stringify([{ ...carriers[2], requiresSize: "true", disallowsCod: "false" }])),
				"api/rest": () => okXml("<id>1</id><barcode>Z1</barcode>"),
			})
			await expect(service().createFulfillment(data, [], order, { id: "f" })).rejects.toThrow(
				/requires packet dimensions/,
			)
			await expect(
				service({ default_size: { length: 1, width: 2, height: 3 } }).createFulfillment(data, [], order, {
					id: "f",
				}),
			).resolves.toBeTruthy()
			expect(calls.find((c) => c.url.includes("api/rest"))!.init.body).toContain("<size>")
		})

		it("maps Packeta faults to MedusaError", async () => {
			installFetch({
				"/carrier/json": () => new Response(JSON.stringify(carriers)),
				"api/rest": () => faultXml("PacketAttributesFault", "Failed to validate attributes."),
			})
			await expect(
				service().createFulfillment(
					{ kind: "pickup", option_id: "packeta-pickup", point_id: "79" },
					[],
					order,
					{ id: "ful_1" },
				),
			).rejects.toMatchObject({ type: "invalid_data" })
		})
	})

	describe("cancelFulfillment", () => {
		it("cancels once and is idempotent", async () => {
			installFetch({ "api/rest": () => okXml("") })
			const s = service()
			const out = await s.cancelFulfillment({ packet_id: "1", barcode: "Z1" })
			expect(out.cancelled_at).toBeTruthy()
			expect(calls).toHaveLength(1)
			await s.cancelFulfillment(out)
			expect(calls).toHaveLength(1)
		})

		it("surfaces CancelNotAllowedFault", async () => {
			installFetch({
				"api/rest": () => faultXml("CancelNotAllowedFault", "Packet state does not allow this operation."),
			})
			await expect(service().cancelFulfillment({ packet_id: "1" })).rejects.toThrow(/CancelNotAllowedFault/)
		})
	})

	describe("createReturnFulfillment", () => {
		it("creates a claim-assistant packet with password", async () => {
			installFetch({
				"api/rest": () => okXml("<id>99</id><barcode>Z99</barcode><password>SECRET</password>"),
			})
			const res = await service().createReturnFulfillment({
				id: "ful_r",
				order_id: "order_abc123",
				data: { email: "jan@example.com", value: 250 },
				delivery_address: { phone: "+420777123456", country_code: "cz" },
			})
			expect(res.data).toMatchObject({
				kind: "return",
				packet_id: "99",
				barcode: "Z99",
				password: "SECRET",
				value: 250,
				currency: "CZK",
				number: "RET-abc123",
			})
			const body = calls[0].init.body as string
			expect(body).toContain("<createPacketClaimWithPassword>")
			expect(body).toContain("<consignCountry>cz</consignCountry>")
			expect(body).toContain("<sendEmailToCustomer>1</sendEmailToCustomer>")
		})

		it("requires a contact", async () => {
			await expect(
				service().createReturnFulfillment({ id: "f", data: {}, delivery_address: {} }),
			).rejects.toThrow(/email or phone/)
		})
	})

	it("returns label documents", async () => {
		installFetch({ "api/rest": () => okXml("JVBERi0=") })
		const docs = await service().getFulfillmentDocuments({ packet_id: "1", barcode: "Z1" })
		expect(docs).toEqual([{ type: "label", format: "pdf", base64: "JVBERi0=", filename: "packeta-Z1.pdf" }])
		expect(calls[0].init.body as string).toContain("<format>A6 on A6</format>")
	})
})
