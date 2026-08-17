import {
	buildPacketAttributes,
	decideCod,
	packetWeightKg,
	splitName,
	splitStreet,
	trackingUrl,
} from "../lib/packet"
import { PacketaFeed, parseCarriers, pickHomeDeliveryCarrier } from "../lib/feed"
import { resolveOptions, type PacketaFulfillmentData } from "../types"

const options = resolveOptions({ api_password: "x".repeat(32), api_key: "k".repeat(16), eshop: "shop" })

const order = {
	id: "order_1",
	display_id: 1042,
	email: "jan@example.com",
	currency_code: "czk",
	total: 1299.5,
	metadata: {},
	shipping_address: {
		first_name: "Jan",
		last_name: "Novák",
		company: "ACME s.r.o.",
		phone: "+420777123456",
		address_1: "Českomoravská 2408/1a",
		city: "Praha",
		postal_code: "190 00",
		country_code: "cz",
	},
	items: [
		{ id: "li_1", variant: { weight: 250 } },
		{ id: "li_2", variant: { weight: null } },
	],
} as any

const items = [
	{ line_item_id: "li_1", quantity: 2 },
	{ line_item_id: "li_2", quantity: 1 },
]

describe("splitStreet", () => {
	it("splits trailing house numbers", () => {
		expect(splitStreet("Českomoravská 2408/1a")).toEqual({ street: "Českomoravská", houseNumber: "2408/1a" })
		expect(splitStreet("Na Pankráci 969/97")).toEqual({ street: "Na Pankráci", houseNumber: "969/97" })
		expect(splitStreet("Hlavní 12")).toEqual({ street: "Hlavní", houseNumber: "12" })
	})
	it("prefers address_2 when it looks like a number", () => {
		expect(splitStreet("Hlavní", "12b")).toEqual({ street: "Hlavní", houseNumber: "12b" })
	})
	it("handles leading numbers and no numbers", () => {
		expect(splitStreet("12 Main Street")).toEqual({ street: "Main Street", houseNumber: "12" })
		expect(splitStreet("Náměstí Míru")).toEqual({ street: "Náměstí Míru", houseNumber: "" })
	})
})

describe("splitName", () => {
	it("keeps first/last when both present", () => {
		expect(splitName("Jan", "Novák")).toEqual({ name: "Jan", surname: "Novák" })
	})
	it("splits a single field", () => {
		expect(splitName("Jan Karel Novák", "")).toEqual({ name: "Jan Karel", surname: "Novák" })
		expect(splitName("Madonna", null)).toEqual({ name: "Madonna", surname: "Madonna" })
	})
})

describe("packetWeightKg", () => {
	it("sums known variant weights × quantity plus packaging", () => {
		expect(packetWeightKg(items, order.items, options)).toBe(0.6)
	})
	it("falls back to the default when nothing is known", () => {
		expect(packetWeightKg([{ line_item_id: "li_2", quantity: 1 }], order.items, options)).toBe(0.5)
	})
})

describe("decideCod", () => {
	it("prefers explicit admin input", () => {
		expect(decideCod(order, { cod: false }, 100)).toEqual({ cod: 0, source: "additional_data" })
		expect(decideCod(order, { cod_amount: 42.4 }, 100)).toEqual({ cod: 42.4, source: "additional_data" })
		expect(decideCod(order, { cod: true }, 100)).toEqual({ cod: 100, source: "additional_data" })
	})
	it("uses the order flag set at order.placed", () => {
		expect(decideCod({ ...order, metadata: { packeta_cod: true } }, undefined, 100)).toEqual({
			cod: 100,
			source: "order_metadata",
		})
		expect(decideCod({ ...order, metadata: { packeta_cod: 55 } }, undefined, 100)).toEqual({
			cod: 55,
			source: "order_metadata",
		})
	})
	it("defaults to no COD", () => {
		expect(decideCod(order, undefined, 100)).toEqual({ cod: 0, source: "none" })
	})
})

describe("buildPacketAttributes", () => {
	it("maps a pickup order", () => {
		const data: PacketaFulfillmentData = {
			kind: "pickup",
			option_id: "packeta-pickup",
			point_id: "79",
			point: { id: "79", name: "Praha 4" },
		}
		const b = buildPacketAttributes({ order, items, data, options, fallbackNumber: "f" })
		expect(b.attributes).toMatchObject({
			number: "1042",
			name: "Jan",
			surname: "Novák",
			company: "ACME s.r.o.",
			email: "jan@example.com",
			phone: "+420777123456",
			addressId: "79",
			currency: "CZK",
			cod: 0,
			value: 1299.5,
			weight: 0.6,
			eshop: "shop",
		})
		expect(b.attributes.street).toBeUndefined()
		expect(b.attributes.carrierPickupPoint).toBeUndefined()
	})

	it("maps an external carrier pickup point", () => {
		const data: PacketaFulfillmentData = {
			kind: "pickup",
			option_id: "packeta-carrier-3060",
			carrier_id: "3060",
			carrier_pickup_point_id: "BIA10M",
		}
		const b = buildPacketAttributes({ order, items, data, options, fallbackNumber: "f" })
		expect(b.attributes.addressId).toBe("3060")
		expect(b.attributes.carrierPickupPoint).toBe("BIA10M")
	})

	it("maps home delivery from the Medusa address", () => {
		const data: PacketaFulfillmentData = { kind: "hd", option_id: "packeta-home-delivery", carrier_id: "106" }
		const b = buildPacketAttributes({ order, items, data, options, fallbackNumber: "f" })
		expect(b.attributes).toMatchObject({
			addressId: "106",
			street: "Českomoravská",
			houseNumber: "2408/1a",
			city: "Praha",
			zip: "19000",
		})
		expect(b.address).toEqual({
			street: "Českomoravská",
			house_number: "2408/1a",
			city: "Praha",
			zip: "19000",
			country: "cz",
			region: undefined,
		})
	})

	it("prefers the HD widget address snapshot", () => {
		const data: PacketaFulfillmentData = {
			kind: "hd",
			option_id: "packeta-home-delivery",
			carrier_id: "106",
			address: { street: "Vinohradská", house_number: "1", city: "Praha", zip: "120 00", country: "cz" },
		}
		const b = buildPacketAttributes({ order, items, data, options, fallbackNumber: "f" })
		expect(b.attributes).toMatchObject({ street: "Vinohradská", houseNumber: "1", zip: "12000" })
	})

	it("applies admin overrides and COD flag", () => {
		const data: PacketaFulfillmentData = { kind: "pickup", option_id: "packeta-pickup", point_id: "79" }
		const b = buildPacketAttributes({
			order: { ...order, metadata: { packeta_cod: true } },
			items,
			data,
			additional: { weight_kg: 2.25, note: 'Fragile; "glass"', number_prefix: "PC-" },
			options,
			fallbackNumber: "f",
		})
		expect(b.attributes.cod).toBe(1299.5)
		expect(b.attributes.weight).toBe(2.25)
		expect(b.attributes.note).toBe("Fragile glass")
		expect(b.attributes.number).toBe("PC-1042")
	})

	it("falls back to the destination currency when the order currency is unsupported", () => {
		const data: PacketaFulfillmentData = {
			kind: "pickup",
			option_id: "packeta-pickup",
			point_id: "79",
			point: { country: "sk" },
		}
		const b = buildPacketAttributes({
			order: {
				...order,
				currency_code: "usd",
				shipping_address: { ...order.shipping_address, country_code: "sk" },
			},
			items,
			data,
			options,
			fallbackNumber: "f",
		})
		expect(b.attributes.currency).toBe("EUR")
	})
})

describe("trackingUrl", () => {
	it("substitutes placeholders", () => {
		expect(trackingUrl("https://t/?id={barcode}&x={id}", "Z1", "1")).toBe("https://t/?id=Z1&x=1")
	})
})

describe("feed", () => {
	const raw = [
		{
			id: "80",
			name: "AT Rakouská pošta HD",
			available: "true",
			pickupPoints: "false",
			apiAllowed: "true",
			disallowsCod: "false",
			country: "at",
			currency: "EUR",
			maxWeight: "30",
		},
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
			id: "3060",
			name: "PL InPost Paczkomaty",
			available: "true",
			pickupPoints: "true",
			requiresSize: "true",
			country: "pl",
			currency: "PLN",
			maxWeight: "25",
		},
		{
			id: "999",
			name: "CZ Some other HD",
			available: "true",
			pickupPoints: "false",
			country: "cz",
			currency: "CZK",
			maxWeight: "30",
		},
		{
			id: "26637",
			name: "CZ Zásilkovna večerní doručení Brno HD",
			available: "true",
			pickupPoints: "false",
			country: "cz",
			currency: "CZK",
			maxWeight: "30",
		},
	]

	it("normalises string booleans and numbers", () => {
		const list = parseCarriers(raw)
		expect(list[0]).toMatchObject({
			id: "80",
			available: true,
			pickupPoints: false,
			apiAllowed: true,
			country: "at",
			maxWeight: 30,
		})
		expect(list[2].requiresSize).toBe(true)
	})

	it("prefers Packeta's own HD carrier per country", () => {
		const list = parseCarriers(raw).filter((c) => c.country === "cz" && !c.pickupPoints)
		expect(pickHomeDeliveryCarrier(list)?.id).toBe("106")
		// Evening/express city variants never win over a plain HD service.
		expect(pickHomeDeliveryCarrier(list.filter((c) => c.id !== "106"))?.id).toBe("999")
		expect(pickHomeDeliveryCarrier(list.filter((c) => c.id === "26637"))?.id).toBe("26637")
	})

	it("caches within the TTL and dedupes concurrent loads", async () => {
		const fetch = jest.fn(async () => new Response(JSON.stringify(raw), { status: 200 }))
		global.fetch = fetch as unknown as typeof fetch
		const feed = new PacketaFeed({ api_key: "k".repeat(16), feed_ttl_s: 60 })
		const [a, b] = await Promise.all([feed.carriers(), feed.carriers()])
		expect(a).toBe(b)
		await feed.carriers()
		expect(fetch).toHaveBeenCalledTimes(1)
		expect((fetch.mock.calls[0] as unknown as [string])[0]).toBe(
			"https://pickup-point.api.packeta.com/v5/kkkkkkkkkkkkkkkk/carrier/json?lang=en",
		)
		expect((await feed.homeDeliveryCarrier("CZ"))?.id).toBe("106")
		expect((await feed.carrier(3060))?.name).toBe("PL InPost Paczkomaty")
	})
})
