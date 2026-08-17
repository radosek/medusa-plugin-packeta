import { addressToShippingMethodData, formatPoint, pointToShippingMethodData } from "../../../widget"

describe("storefront widget helper", () => {
	it("maps an internal point", () => {
		const d = pointToShippingMethodData({
			id: "79",
			name: "Praha 4, Na Pankráci",
			street: "Na Pankráci 969/97",
			city: "Praha",
			zip: "140 00",
			country: "CZ",
			group: "",
			pickupPointType: "internal",
		})
		expect(d).toEqual({
			point_id: "79",
			carrier_id: undefined,
			carrier_pickup_point_id: undefined,
			point: {
				id: "79",
				name: "Praha 4, Na Pankráci",
				street: "Na Pankráci 969/97",
				city: "Praha",
				zip: "140 00",
				country: "cz",
				group: "",
				carrier_id: undefined,
				carrier_pickup_point_id: undefined,
				type: "internal",
			},
		})
	})

	it("maps an external carrier point", () => {
		const d = pointToShippingMethodData(
			{
				carrierId: "3060",
				carrierPickupPointId: "BIA10M",
				pickupPointType: "external",
				name: "Paczkomat",
				country: "pl",
			},
			"leave at door",
		)
		expect(d).toMatchObject({
			point_id: undefined,
			carrier_id: "3060",
			carrier_pickup_point_id: "BIA10M",
			note: "leave at door",
			point: { type: "external", carrier_id: "3060", carrier_pickup_point_id: "BIA10M" },
		})
	})

	it("maps an HD address", () => {
		expect(
			addressToShippingMethodData(
				{ street: "Vinohradská", houseNumber: "1", city: "Praha", postcode: "120 00", country: "CZ" },
				"106",
			),
		).toEqual({
			carrier_id: "106",
			address: {
				street: "Vinohradská",
				house_number: "1",
				city: "Praha",
				zip: "120 00",
				country: "cz",
				region: undefined,
			},
		})
	})

	it("formats a point for display", () => {
		expect(formatPoint({ name: "Z-BOX", street: "Hlavní 1", city: "Brno" })).toBe("Z-BOX — Hlavní 1, Brno")
		expect(formatPoint({ id: "5" })).toBe("#5")
	})
})
