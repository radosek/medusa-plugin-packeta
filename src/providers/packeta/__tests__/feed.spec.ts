import { applyCarrierFilter, carrierType } from "../lib/feed"
import type { PacketaCarrier } from "../types"

const carrier = (over: Partial<PacketaCarrier>): PacketaCarrier => ({
	id: "0",
	name: "Carrier",
	available: true,
	pickupPoints: false,
	apiAllowed: true,
	separateHouseNumber: false,
	customsDeclarations: false,
	requiresEmail: false,
	requiresPhone: false,
	requiresSize: false,
	disallowsCod: false,
	country: "cz",
	currency: "CZK",
	maxWeight: 30,
	...over,
})

const list = [
	carrier({ id: "106", name: "CZ Zásilkovna domů HD", country: "cz" }),
	carrier({ id: "131", name: "SK Packeta Home HD", country: "sk" }),
	carrier({
		id: "3060",
		name: "PL InPost Paczkomaty",
		country: "pl",
		pickupPoints: true,
		disallowsCod: true,
	}),
	carrier({ id: "4500", name: "CZ PPL ParcelShop", country: "cz", pickupPoints: true, maxWeight: 10 }),
	carrier({ id: "4", name: "CH Post HD", country: "ch", customsDeclarations: true }),
]

describe("carrierType", () => {
	it("detects hd, box and pickup from the feed flags and name", () => {
		expect(carrierType(list[0])).toBe("hd")
		expect(carrierType(list[2])).toBe("box")
		expect(carrierType(list[3])).toBe("pickup")
		expect(carrierType(carrier({ pickupPoints: true, name: "Foo Locker" }))).toBe("box")
	})
})

describe("applyCarrierFilter", () => {
	it("returns the same list without a filter", () => {
		expect(applyCarrierFilter(list, undefined)).toBe(list)
		expect(applyCarrierFilter(list, {})).toHaveLength(list.length)
	})

	it("filters by countries, case-insensitively", () => {
		expect(applyCarrierFilter(list, { countries: ["CZ"] }).map((c) => c.id)).toEqual(["106", "4500"])
	})

	it("filters by delivery type", () => {
		expect(applyCarrierFilter(list, { types: ["hd"] }).map((c) => c.id)).toEqual(["106", "131", "4"])
		expect(applyCarrierFilter(list, { types: ["box"] }).map((c) => c.id)).toEqual(["3060"])
		expect(applyCarrierFilter(list, { types: ["pickup", "box"] }).map((c) => c.id)).toEqual(["3060", "4500"])
	})

	it("filters by cod, eu_only and min_max_weight_kg", () => {
		expect(applyCarrierFilter(list, { cod: true }).map((c) => c.id)).toEqual(["106", "131", "4500", "4"])
		expect(applyCarrierFilter(list, { eu_only: true }).map((c) => c.id)).toEqual([
			"106",
			"131",
			"3060",
			"4500",
		])
		expect(applyCarrierFilter(list, { min_max_weight_kg: 15 }).map((c) => c.id)).toEqual([
			"106",
			"131",
			"3060",
			"4",
		])
	})

	it("applies exclude_ids last and combines criteria", () => {
		expect(applyCarrierFilter(list, { countries: ["cz"], exclude_ids: ["4500"] }).map((c) => c.id)).toEqual([
			"106",
		])
		expect(
			applyCarrierFilter(list, { types: ["hd"], cod: true, exclude_ids: ["131"] }).map((c) => c.id),
		).toEqual(["106", "4"])
	})
})
