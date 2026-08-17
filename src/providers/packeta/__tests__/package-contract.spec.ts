import { readFileSync } from "node:fs"
import { join } from "node:path"
import PacketaProviderService from "../service"
import providerExport from "../index"
import { OPTION_HOME_DELIVERY, OPTION_PICKUP, OPTION_RETURN } from "../types"

/**
 * Guards the consumer-facing contract. Breaking any of these breaks every
 * merchant's `medusa-config.ts` on upgrade, silently at boot.
 */
const pkg = JSON.parse(readFileSync(join(__dirname, "../../../../package.json"), "utf8"))

describe("package contract", () => {
	it("keeps the provider identifier stable", () => {
		// Resolved provider id is `fp_packeta_packeta`; changing it orphans shipping options.
		expect(PacketaProviderService.identifier).toBe("packeta")
	})

	it("keeps the fulfillment option ids stable", () => {
		// Shipping options reference these by id in the database.
		expect(OPTION_PICKUP).toBe("packeta-pickup")
		expect(OPTION_HOME_DELIVERY).toBe("packeta-home-delivery")
		expect(OPTION_RETURN).toBe("packeta-return")
	})

	it("keeps the documented subpath exports resolvable", () => {
		expect(pkg.exports["./providers/*"]).toBe("./.medusa/server/src/providers/*/index.js")
		expect(pkg.exports["./modules/*"]).toBe("./.medusa/server/src/modules/*/index.js")
		expect(pkg.exports["./.medusa/server/src/modules/*"]).toBe("./.medusa/server/src/modules/*/index.js")
		expect(pkg.exports["./workflows"]).toBe("./.medusa/server/src/workflows/index.js")
		expect(pkg.exports["./widget"]).toEqual({
			types: "./.medusa/server/src/widget/index.d.ts",
			default: "./.medusa/server/src/widget/index.js",
		})
		expect(pkg.exports["./admin"]).toMatchObject({
			import: "./.medusa/server/src/admin/index.mjs",
			require: "./.medusa/server/src/admin/index.js",
		})
	})

	it("ships the built plugin output", () => {
		expect(pkg.files).toEqual(expect.arrayContaining([".medusa/server"]))
	})

	it("stays installable on any Medusa 2.x host", () => {
		expect(pkg.peerDependencies["@medusajs/framework"]).toBe("2.x")
		expect(pkg.peerDependencies["@medusajs/medusa"]).toBe("2.x")
	})

	it("keeps the Medusa plugin keywords used by the integrations listing", () => {
		expect(pkg.keywords).toEqual(
			expect.arrayContaining([
				"medusa-v2",
				"medusa-plugin-integration",
				"medusa-plugin-shipping",
				"medusa-plugin",
			]),
		)
	})

	it("exports the provider as a module provider default export", () => {
		expect(providerExport).toBeDefined()
	})

	it("implements every fulfillment-provider method Medusa calls", () => {
		const required = [
			"getFulfillmentOptions",
			"validateFulfillmentData",
			"validateOption",
			"canCalculate",
			"calculatePrice",
			"createFulfillment",
			"cancelFulfillment",
			"createReturnFulfillment",
			"getFulfillmentDocuments",
			"getReturnDocuments",
			"getShipmentDocuments",
			"retrieveDocuments",
		]
		for (const m of required) {
			expect(typeof (PacketaProviderService.prototype as unknown as Record<string, unknown>)[m]).toBe(
				"function",
			)
		}
	})
})
