import type { FulfillmentItemDTO, FulfillmentOrderDTO } from "@medusajs/framework/types"
import type {
	PacketAttributes,
	PacketaAdditionalData,
	PacketaAddressSnapshot,
	PacketaAttribute,
	PacketaCarrier,
	PacketaFulfillmentData,
	ResolvedPacketaOptions,
} from "../types"

/** Currencies Packeta accepts for `cod`/`value`. */
export const PACKETA_CURRENCIES = ["CZK", "EUR", "HUF", "PLN", "RON"] as const

/** Default currency by destination country when the order currency is unusable. */
const COUNTRY_CURRENCY: Record<string, string> = {
	cz: "CZK",
	sk: "EUR",
	hu: "HUF",
	pl: "PLN",
	ro: "RON",
}

export function currencyForCountry(country?: string | null, fallback = "CZK"): string {
	return COUNTRY_CURRENCY[(country ?? "").toLowerCase()] ?? fallback
}

/**
 * Split "Českomoravská 2408/1a" into street + house number. Medusa has one
 * `address_1` line; Packeta HD needs `street` and `houseNumber` separately.
 * `address_2` wins as the house number when it looks like one.
 */
export function splitStreet(
	address1: string,
	address2?: string | null,
): { street: string; houseNumber: string } {
	const a1 = (address1 ?? "").trim().replace(/\s+/g, " ")
	const a2 = (address2 ?? "").trim()
	if (a2 && /^\d[\w/-]*$/.test(a2)) return { street: a1, houseNumber: a2 }
	const m = a1.match(/^(.*?)[\s,]+(\d[\w/-]*)$/)
	if (m && m[1]) return { street: m[1].replace(/,$/, "").trim(), houseNumber: m[2] }
	const lead = a1.match(/^(\d[\w/-]*)\s+(.+)$/)
	if (lead) return { street: lead[2].trim(), houseNumber: lead[1] }
	return { street: a1, houseNumber: a2 || "" }
}

export function splitName(first?: string | null, last?: string | null): { name: string; surname: string } {
	const f = (first ?? "").trim()
	const l = (last ?? "").trim()
	if (f && l) return { name: f, surname: l }
	const parts = (f || l).split(/\s+/).filter(Boolean)
	if (parts.length >= 2) return { name: parts.slice(0, -1).join(" "), surname: parts[parts.length - 1] }
	return { name: parts[0] ?? "", surname: parts[0] ?? "" }
}

/** Sum variant weights (grams) × quantity, add packaging, convert to kg. */
export function packetWeightKg(
	items: Partial<FulfillmentItemDTO & { quantity?: number; variant?: { weight?: number | null } | null }>[],
	orderItems: { id: string; variant?: { weight?: number | null } | null; quantity?: number }[] | undefined,
	options: Pick<ResolvedPacketaOptions, "default_weight_kg" | "packaging_weight_g">,
): number {
	const byLineItem = new Map((orderItems ?? []).map((i) => [i.id, i]))
	let grams = 0
	let known = false
	for (const it of items) {
		const line = it.line_item_id ? byLineItem.get(it.line_item_id) : undefined
		const w = num(line?.variant?.weight ?? it.variant?.weight)
		const qty = num(it.quantity) || 1
		if (w > 0) {
			grams += w * qty
			known = true
		}
	}
	if (!known) return options.default_weight_kg
	return round2((grams + options.packaging_weight_g) / 1000)
}

export interface CodDecision {
	cod: number
	source: "additional_data" | "order_metadata" | "none"
}

/** COD amount: explicit admin input > order flag (set at `order.placed`) > none. */
export function decideCod(
	order: Partial<FulfillmentOrderDTO> | undefined,
	additional: PacketaAdditionalData | undefined,
	orderTotal: number,
): CodDecision {
	if (additional?.cod === false) return { cod: 0, source: "additional_data" }
	if (typeof additional?.cod_amount === "number" && additional.cod_amount >= 0) {
		return { cod: round2(additional.cod_amount), source: "additional_data" }
	}
	if (additional?.cod === true) return { cod: round2(orderTotal), source: "additional_data" }
	const meta = (order?.metadata ?? {}) as Record<string, unknown>
	if (meta.packeta_cod === true || meta.packeta_cod === "true")
		return { cod: round2(orderTotal), source: "order_metadata" }
	if (typeof meta.packeta_cod === "number" && meta.packeta_cod > 0)
		return { cod: round2(meta.packeta_cod), source: "order_metadata" }
	return { cod: 0, source: "none" }
}

export interface BuildPacketInput {
	order: Partial<FulfillmentOrderDTO> | undefined
	items: Partial<FulfillmentItemDTO>[]
	data: PacketaFulfillmentData
	additional?: PacketaAdditionalData
	options: ResolvedPacketaOptions
	/** Destination carrier (feed row) when known — drives size/customs requirements. */
	carrier?: PacketaCarrier
	/** Fallback reference when the order has no display id (should not happen). */
	fallbackNumber: string
}

export interface BuiltPacket {
	attributes: PacketAttributes
	cod: CodDecision
	currency: string
	value: number
	weightKg: number
	number: string
	address?: PacketaAddressSnapshot
}

/** Pure mapping of Medusa order + validated shipping-method data → Packeta `PacketAttributes`. */
export function buildPacketAttributes(input: BuildPacketInput): BuiltPacket {
	const { order, items, data, additional, options } = input
	const addr = order?.shipping_address ?? undefined
	const { name, surname } = splitName(addr?.first_name, addr?.last_name)
	// `createOrderFulfillmentWorkflow` loads `customer.*` but not `order.email`,
	// so fall back to the customer record (guest checkouts get one too).
	const o = order as
		| {
				email?: string | null
				customer?: { email?: string | null; phone?: string | null } | null
				billing_address?: { phone?: string | null } | null
		  }
		| undefined
	const email = (o?.email ?? o?.customer?.email ?? "").trim() || undefined
	const phone = (addr?.phone ?? o?.customer?.phone ?? o?.billing_address?.phone ?? "").trim() || undefined
	const country = (addr?.country_code ?? data.point?.country ?? "").toLowerCase()

	const orderCurrency = String(
		(order as { currency_code?: string } | undefined)?.currency_code ?? "",
	).toUpperCase()
	const currency = (PACKETA_CURRENCIES as readonly string[]).includes(orderCurrency)
		? orderCurrency
		: currencyForCountry(country, orderCurrency || "CZK")

	const total = num((order as { total?: unknown } | undefined)?.total)
	const value = round2(total > 0 ? total : 1)
	const cod = decideCod(order, additional, total)
	const weightKg =
		typeof additional?.weight_kg === "number" && additional.weight_kg > 0
			? round2(additional.weight_kg)
			: packetWeightKg(
					items,
					(order as { items?: { id: string; variant?: { weight?: number | null } | null }[] } | undefined)
						?.items,
					options,
				)

	const displayId =
		(order as { display_id?: number | string; custom_display_id?: string } | undefined)?.custom_display_id ??
		(order as { display_id?: number | string } | undefined)?.display_id
	const number =
		additional?.number ??
		`${additional?.number_prefix ?? ""}${displayId ?? input.fallbackNumber}`.slice(0, 36)

	const attributes: PacketAttributes = {
		number,
		name,
		surname,
		company: addr?.company?.trim() || undefined,
		email,
		phone,
		addressId: "",
		currency,
		cod: cod.cod,
		value,
		weight: weightKg,
		eshop: additional?.eshop ?? options.eshop,
		note: (additional?.note ?? data.note)?.trim().replace(/[";]/g, "").slice(0, 128) || undefined,
		deliverOn: additional?.deliver_on,
		adultContent: additional?.adult_content,
		size: additional?.size ?? (input.carrier?.requiresSize ? options.default_size : undefined),
		carrierService: additional?.carrier_service,
	}

	const wantsCustoms =
		!!input.carrier?.customsDeclarations || !!additional?.customs || !!additional?.customs_items
	if (wantsCustoms) {
		const customs = buildCustoms(input, currency, weightKg)
		attributes.attributes = customs.attributes
		attributes.items = customs.items
	}

	let address: PacketaAddressSnapshot | undefined
	if (data.kind === "pickup") {
		if (data.carrier_id && data.carrier_pickup_point_id) {
			attributes.addressId = String(data.carrier_id)
			attributes.carrierPickupPoint = String(data.carrier_pickup_point_id)
		} else {
			attributes.addressId = String(data.point_id ?? data.point?.id ?? "")
		}
	} else {
		attributes.addressId = String(data.carrier_id ?? "")
		const snap = data.address
		const split =
			snap?.street && snap.house_number
				? { street: snap.street, houseNumber: snap.house_number }
				: splitStreet(snap?.street ?? addr?.address_1 ?? "", snap?.house_number ?? addr?.address_2)
		address = {
			street: split.street,
			house_number: split.houseNumber,
			city: snap?.city ?? addr?.city ?? "",
			zip: (snap?.zip ?? addr?.postal_code ?? "").replace(/\s+/g, ""),
			country: (snap?.country ?? country).toLowerCase(),
			region: snap?.region ?? addr?.province ?? undefined,
		}
		attributes.street = address.street
		attributes.houseNumber = address.house_number || undefined
		attributes.city = address.city
		attributes.zip = address.zip
		attributes.province = address.region || undefined
	}

	return { attributes, cod, currency, value, weightKg, number, address }
}

export function trackingUrl(template: string, barcode: string, id: string): string {
	return template
		.replace(/\{barcode\}/g, encodeURIComponent(barcode))
		.replace(/\{id\}/g, encodeURIComponent(id))
}

/** Coerce Medusa amounts (number, string, BigNumber-ish `{ value }` / `{ numeric }`) to a plain number. */
export function num(v: unknown): number {
	if (typeof v === "number") return Number.isFinite(v) ? v : 0
	if (typeof v === "string") return Number(v) || 0
	if (v && typeof v === "object") {
		const o = v as { numeric?: unknown; value?: unknown; toNumber?: () => number }
		if (typeof o.toNumber === "function") return o.toNumber()
		if (o.numeric != null) return num(o.numeric)
		if (o.value != null) return num(o.value)
	}
	return 0
}

export function round2(n: number): number {
	return Math.round(n * 100) / 100
}

/**
 * Customs declaration for non-EU carriers: packet attributes from options +
 * `additional_data.customs`, items from the fulfilled order lines (HS code,
 * origin country, EN name, value, units, weight). Anything the merchant passes
 * explicitly wins.
 */
export function buildCustoms(
	input: BuildPacketInput,
	currency: string,
	packetWeightKg: number,
): { attributes: PacketaAttribute[]; items: PacketaAttribute[][] } {
	const { order, items, additional, options } = input
	const o = order as
		| {
				display_id?: number | string
				shipping_total?: unknown
				items?: {
					id: string
					title?: string
					product_title?: string
					variant_title?: string
					unit_price?: unknown
					quantity?: unknown
					variant?: {
						weight?: number | null
						hs_code?: string | null
						origin_country?: string | null
						product?: {
							hs_code?: string | null
							origin_country?: string | null
							title?: string | null
						} | null
					} | null
				}[]
		  }
		| undefined
	const cfg = options.customs ?? {}
	const packetAttrs: Record<string, string | number | boolean> = {
		ead: cfg.ead ?? "carrier",
		deliveryCost: round2(num(o?.shipping_total)),
		invoiceNumber: (cfg.invoice_number ?? "{display_id}").replace(
			"{display_id}",
			String(o?.display_id ?? ""),
		),
		invoiceIssueDate: new Date().toISOString().slice(0, 10),
		...additional?.customs,
	}
	const attributes = Object.entries(packetAttrs)
		.filter(([, v]) => v !== undefined && v !== null && v !== "")
		.map(([key, value]) => ({ key, value }))

	if (additional?.customs_items?.length) return { attributes, items: additional.customs_items }

	const byLine = new Map((o?.items ?? []).map((i) => [i.id, i]))
	const built: PacketaAttribute[][] = []
	let knownWeight = 0
	const perItem: {
		attrs: Record<string, string | number | boolean>
		units: number
		weightKg: number | null
	}[] = []
	for (const it of items) {
		const line = it.line_item_id ? byLine.get(it.line_item_id) : undefined
		if (!line) continue
		const units = num(it.quantity) || num(line.quantity) || 1
		const unit = num(line.unit_price)
		const w = num(line.variant?.weight)
		const weightKg = w > 0 ? round2((w * units) / 1000) : null
		if (weightKg) knownWeight += weightKg
		perItem.push({
			attrs: {
				customsCode: line.variant?.hs_code ?? line.variant?.product?.hs_code ?? cfg.default_hs_code ?? "",
				countryOfOrigin: (
					line.variant?.origin_country ??
					line.variant?.product?.origin_country ??
					cfg.default_origin_country ??
					""
				).toUpperCase(),
				productNameEn: line.product_title ?? line.title ?? line.variant?.product?.title ?? "Item",
				productName: line.title ?? line.product_title ?? "",
				value: round2(unit * units),
				unitsCount: units,
			},
			units,
			weightKg,
		})
	}
	// Distribute unknown weights so item weights sum to the packet weight (Packeta requires > 0 each).
	const unknown = perItem.filter((p) => !p.weightKg)
	const spare = Math.max(packetWeightKg - knownWeight, 0.01 * Math.max(unknown.length, 1))
	for (const p of perItem) {
		const weight = p.weightKg ?? round2(Math.max(spare / Math.max(unknown.length, 1), 0.01))
		built.push(Object.entries({ ...p.attrs, weight }).map(([key, value]) => ({ key, value })))
	}
	return { attributes, items: built }
}
