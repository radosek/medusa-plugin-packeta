/**
 * Storefront helper for the Packeta widgets. Browser-only, dependency-free,
 * no Medusa imports — import it from `medusa-plugin-packeta/widget` in any
 * framework (Next.js starter, Remix, plain JS).
 *
 *   const point = await pickPoint(PACKETA_API_KEY, { language: "cs", country: "cz" })
 *   if (point) await sdk.store.cart.addShippingMethod(cart.id, { option_id, data: pointToShippingMethodData(point) })
 *
 * The backend validates the selection again (`validateFulfillmentData`), so
 * nothing here is trusted on its own.
 */

export const PACKETA_WIDGET_URL = "https://widget.packeta.com/v6/www/js/library.js"
export const PACKETA_HD_WIDGET_URL = "https://hd.widget.packeta.com/www/js/library.js"

/** `Packeta.Widget.pick` options (pickup-point widget v6). */
export interface PacketaWidgetOptions {
	webUrl?: string
	appIdentity?: string
	vendors?: PacketaVendor[]
	/** Lower-case ISO 3166-1 alpha-2, comma separated ("cz,sk"). */
	country?: string
	language?: string
	claimAssistant?: "yes" | "no"
	packetConsignment?: "yes" | "no"
	weight?: number
	length?: number
	width?: number
	depth?: number
	longitude?: number
	latitude?: number
	livePickupPoint?: boolean
	expeditionDay?: string
	defaultPrice?: number
	defaultCurrency?: string
	centerExternalId?: string
	[k: string]: unknown
}

export interface PacketaVendor {
	/** External carrier id — or omit and use country + group for Packeta's own points. */
	carrierId?: string
	country?: string
	/** "zbox" or "" (Z-Point). */
	group?: "zbox" | ""
	selected?: boolean
	price?: number
	currency?: string
}

/** Point object the pickup widget passes to the callback. */
export interface PacketaPoint {
	id?: string
	name?: string
	country?: string
	currency?: string
	place?: string
	special?: string
	street?: string
	city?: string
	zip?: string
	gps?: { lat: number; lon: number }
	packetConsignment?: boolean
	claimAssistant?: boolean
	maxWeight?: number
	error?: string | null
	warning?: string | null
	recommended?: string | null
	isNew?: boolean
	creditCardPayment?: boolean | null
	saturdayOpenTo?: number
	sundayOpenTo?: number
	businessDaysOpenUpTo?: number
	businessDaysOpenLunchtime?: boolean
	directions?: string
	directionsCar?: string
	directionsPublic?: string
	exceptionDays?: { from: string; to: string | null }[]
	wheelchairAccessible?: boolean
	branchCode?: string
	photo?: { thumbnail?: string; normal?: string }[]
	openingHours?: unknown
	pickupPointType?: "internal" | "external"
	routingCode?: string
	carrierId?: string
	carrierPickupPointId?: string
	group?: string
	externalId?: string
	/** Deprecated fields still emitted by the widget. */
	nameStreet?: string
	url?: string
	[k: string]: unknown
}

/** `Packeta.Widget.pick` options for the home-delivery widget (`layout: "hd"`). */
export interface PacketaHdOptions {
	layout: "hd"
	carrierId: string
	language?: string
	/** "cz" | "sk" */
	country?: string
	centerCountry?: string
	centerRegion?: string
	centerCity?: string
	centerPostcode?: string
	centerStreet?: string
	centerHouseNumber?: string
	[k: string]: unknown
}

export interface PacketaHdAddress {
	country?: string
	region?: string
	city?: string
	postcode?: string
	street?: string
	houseNumber?: string
	latitude?: string
	longitude?: string
	[k: string]: unknown
}

export interface PacketaHdResult {
	packetaWidgetMessage: true
	address: PacketaHdAddress
}

export interface PacketaWidgetApi {
	pick(
		apiKey: string,
		callback: (result: unknown) => void,
		options?: unknown,
		inElement?: HTMLElement | null,
	): void
	close(): void
}

/** Shape our provider accepts as shipping-method `data` for pickup options. */
export interface PacketaPickupData {
	point_id?: string
	carrier_id?: string
	carrier_pickup_point_id?: string
	point: {
		id?: string
		name?: string
		street?: string
		city?: string
		zip?: string
		country?: string
		group?: string
		carrier_id?: string
		carrier_pickup_point_id?: string
		type: "internal" | "external"
	}
	note?: string
}

/** Shape our provider accepts as shipping-method `data` for home-delivery options. */
export interface PacketaHdData {
	carrier_id?: string
	address: {
		street?: string
		house_number?: string
		city?: string
		zip?: string
		country?: string
		region?: string
	}
	note?: string
}

declare global {
	interface Window {
		Packeta?: { Widget?: PacketaWidgetApi }
	}
}

const loading = new Map<string, Promise<PacketaWidgetApi>>()

/**
 * Inject the widget `library.js` once and resolve `window.Packeta.Widget`.
 * Both Packeta libraries register the same global; the pickup and HD widgets
 * are distinguished by `options.layout`, so loading either script is enough.
 */
export function loadPacketaWidget(url: string = PACKETA_WIDGET_URL): Promise<PacketaWidgetApi> {
	if (typeof window === "undefined")
		return Promise.reject(new Error("Packeta widget can only load in a browser"))
	if (window.Packeta?.Widget) return Promise.resolve(window.Packeta.Widget)
	const existing = loading.get(url)
	if (existing) return existing
	const p = new Promise<PacketaWidgetApi>((resolve, reject) => {
		const done = () => {
			const api = window.Packeta?.Widget
			if (api) resolve(api)
			else reject(new Error("Packeta widget library loaded but window.Packeta.Widget is missing"))
		}
		const found = document.querySelector<HTMLScriptElement>(`script[src="${url}"]`)
		if (found) {
			if (window.Packeta?.Widget) return done()
			found.addEventListener("load", done, { once: true })
			found.addEventListener("error", () => reject(new Error(`Failed to load ${url}`)), { once: true })
			return
		}
		const s = document.createElement("script")
		s.src = url
		s.async = true
		s.addEventListener("load", done, { once: true })
		s.addEventListener("error", () => reject(new Error(`Failed to load ${url}`)), { once: true })
		document.head.appendChild(s)
	}).finally(() => loading.delete(url))
	loading.set(url, p)
	return p
}

/**
 * Open the pickup-point widget and resolve with the chosen point (or `null`
 * when the customer closes it). Pass `inElement` to render inline instead of
 * as an overlay.
 */
export async function pickPoint(
	apiKey: string,
	options: PacketaWidgetOptions = {},
	inElement?: HTMLElement | null,
): Promise<PacketaPoint | null> {
	const api = await loadPacketaWidget(PACKETA_WIDGET_URL)
	return new Promise((resolve) => {
		api.pick(
			apiKey,
			(result) => resolve((result as PacketaPoint | null) ?? null),
			options,
			inElement ?? undefined,
		)
	})
}

/** Open the home-delivery address widget for `carrierId` (CZ/SK Packeta HD). */
export async function pickAddress(
	apiKey: string,
	options: Omit<PacketaHdOptions, "layout"> & { layout?: "hd" },
	inElement?: HTMLElement | null,
): Promise<PacketaHdAddress | null> {
	const api = await loadPacketaWidget(PACKETA_HD_WIDGET_URL)
	return new Promise((resolve) => {
		api.pick(
			apiKey,
			(result) => {
				const r = result as PacketaHdResult | null
				resolve(r?.address ?? null)
			},
			{ ...options, layout: "hd" },
			inElement ?? undefined,
		)
	})
}

export function closePacketaWidget(): void {
	window.Packeta?.Widget?.close()
}

/** Map a widget point to the `data` our fulfillment provider expects. */
export function pointToShippingMethodData(point: PacketaPoint, note?: string): PacketaPickupData {
	const external = point.pickupPointType === "external" || (!!point.carrierId && !!point.carrierPickupPointId)
	const snapshot: PacketaPickupData["point"] = {
		id: external ? undefined : point.id ? String(point.id) : undefined,
		name: point.name ?? point.nameStreet ?? point.place,
		street: point.street,
		city: point.city,
		zip: point.zip,
		country: point.country?.toLowerCase(),
		group: point.group,
		carrier_id: external ? String(point.carrierId) : undefined,
		carrier_pickup_point_id: external ? String(point.carrierPickupPointId) : undefined,
		type: external ? "external" : "internal",
	}
	return {
		point_id: external ? undefined : point.id ? String(point.id) : undefined,
		carrier_id: external ? String(point.carrierId) : undefined,
		carrier_pickup_point_id: external ? String(point.carrierPickupPointId) : undefined,
		point: snapshot,
		...(note ? { note } : {}),
	}
}

/** Map an HD-widget address to the `data` our fulfillment provider expects. */
export function addressToShippingMethodData(
	address: PacketaHdAddress,
	carrierId?: string,
	note?: string,
): PacketaHdData {
	return {
		...(carrierId ? { carrier_id: carrierId } : {}),
		address: {
			street: address.street,
			house_number: address.houseNumber,
			city: address.city,
			zip: address.postcode,
			country: address.country?.toLowerCase(),
			region: address.region,
		},
		...(note ? { note } : {}),
	}
}

/** Human-readable one-liner for a selected point (checkout summary). */
export function formatPoint(point: PacketaPoint): string {
	const name = point.name ?? point.nameStreet ?? point.place ?? (point.id ? `#${point.id}` : "Pickup point")
	const where = [point.street, point.city, point.zip].filter(Boolean).join(", ")
	return where ? `${name} — ${where}` : name
}
