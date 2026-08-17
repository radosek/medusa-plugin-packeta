/**
 * Options shared by the fulfillment provider (`providers/packeta`) and the
 * `packeta` module. Both entries in `medusa-config.ts` receive the same object.
 */
export interface PacketaOptions {
	/** 32-hex REST API password (client section → Support → API password). */
	api_password: string
	/** 16-char API key used by feeds, the widget and the widget validate endpoint. */
	api_key: string
	/** Sender indication (client section → Senders). Created on first use if missing. */
	eshop: string
	/** Payment provider ids that mean "cash on delivery". Default `["pp_system_default"]`. */
	cod_payment_providers?: string[]
	/** Weight (kg) used when the order has no variant weights. Default 0.5. */
	default_weight_kg?: number
	/** Grams added on top of summed variant weights. Default 100. */
	packaging_weight_g?: number
	/** Packeta label format. Default "A6 on A6". */
	label_format?: PacketaLabelFormat
	/** Expose one fulfillment option per carrier from the carrier feed. Default true. */
	expose_carriers?: boolean
	/** Carrier ids to expose, or "all". Default "all". */
	enabled_carriers?: string[] | "all"
	/** Carrier feed cache TTL in seconds. Default 86400. */
	feed_ttl_s?: number
	/** Validate the selected pickup point via the widget validate endpoint. Default true. */
	validate_pickup_point?: boolean
	/** Signing key issued by Packeta for push tracking. Webhook rejects unsigned requests without it. */
	webhook_signing_key?: string
	/** Accept unsigned webhooks (development only; refused when NODE_ENV=production). Default false. */
	allow_unsigned_webhook?: boolean
	/** Max age of a webhook timestamp in seconds before it is rejected as a replay. Default 300. */
	webhook_tolerance_s?: number
	/** Tracking URL template. `{barcode}` and `{id}` placeholders. */
	tracking_url?: string
	/** Packeta status ids that mark the Medusa fulfillment as shipped. Default [2,3,4,5,6,12]. */
	auto_ship_status_ids?: number[]
	/** Packeta status ids that mark the Medusa fulfillment as delivered. Default [7]. */
	auto_deliver_status_ids?: number[]
	/** `value` used for return claims when the return data carries none. Default 1. */
	return_value_default?: number
	/** Packet dimensions in mm sent when a carrier requires size and none was given. */
	default_size?: PacketaSize
	/**
	 * Customs declarations for carriers flagged `customsDeclarations` in the feed
	 * (non-EU). Items are built from order line items (variant hs_code,
	 * origin_country, unit price, weight); packet attributes come from here.
	 * `ead: "carrier"` lets the carrier create the declaration; "create"/"own"
	 * need invoice / EAD storage-file ids passed via `additional_data.customs`.
	 */
	customs?: {
		ead?: "carrier" | "create" | "own"
		/** Fallback HS code when a variant/product has none. */
		default_hs_code?: string
		/** Fallback origin country (ISO alpha-2) when a variant/product has none. */
		default_origin_country?: string
		/** Invoice number template; `{display_id}` placeholder. Default "{display_id}". */
		invoice_number?: string
	}
	/** Poll open packets' status from Packeta (fallback when push tracking is not enabled). Default true. */
	poll_status?: boolean
	/** Cron for the polling job. Default every 30 minutes. */
	poll_status_cron?: string
	/** Max packets per polling run. Default 100. */
	poll_status_batch?: number
	/** Stop polling packets older than this many days. Default 60. */
	poll_status_max_age_days?: number
	/** REST endpoint. */
	base_url?: string
	/** Feed base. */
	feed_base_url?: string
	/** Widget validate endpoint. */
	widget_validate_url?: string
}

export type PacketaLabelFormat =
	| "A6 on A6"
	| "A7 on A7"
	| "A6 on A4"
	| "A7 on A4"
	| "105x35mm on A4"
	| "A8 on A8"

export type PacketaZplDpi = 203 | 300

export const PACKETA_LABEL_FORMATS: readonly PacketaLabelFormat[] = [
	"A6 on A6",
	"A7 on A7",
	"A6 on A4",
	"A7 on A4",
	"105x35mm on A4",
	"A8 on A8",
]

export const PACKETA_DEFAULTS = {
	cod_payment_providers: ["pp_system_default"],
	default_weight_kg: 0.5,
	packaging_weight_g: 100,
	label_format: "A6 on A6" as PacketaLabelFormat,
	expose_carriers: true,
	enabled_carriers: "all" as const,
	feed_ttl_s: 86400,
	validate_pickup_point: true,
	allow_unsigned_webhook: false,
	webhook_tolerance_s: 300,
	tracking_url: "https://tracking.packeta.com/cs/?id={barcode}",
	auto_ship_status_ids: [2, 3, 4, 5, 6, 12],
	auto_deliver_status_ids: [7],
	return_value_default: 1,
	poll_status: true,
	poll_status_cron: "*/30 * * * *",
	poll_status_batch: 100,
	poll_status_max_age_days: 60,
	base_url: "https://www.zasilkovna.cz/api/rest",
	feed_base_url: "https://pickup-point.api.packeta.com/v5",
	widget_validate_url: "https://widget.packeta.com/v6/pps/api/widget/v1/validate",
} as const

export type ResolvedPacketaOptions = Required<
	Omit<PacketaOptions, "webhook_signing_key" | "default_size" | "customs">
> &
	Pick<PacketaOptions, "webhook_signing_key" | "default_size" | "customs">

export function resolveOptions(options: PacketaOptions): ResolvedPacketaOptions {
	return {
		...PACKETA_DEFAULTS,
		enabled_carriers: PACKETA_DEFAULTS.enabled_carriers,
		...stripUndefined(options),
	} as ResolvedPacketaOptions
}

function stripUndefined<T extends object>(o: T): Partial<T> {
	const out: Partial<T> = {}
	for (const [k, v] of Object.entries(o)) {
		if (v !== undefined) (out as Record<string, unknown>)[k] = v
	}
	return out
}

/* ------------------------------------------------------------------ */
/* Fulfillment options                                                 */
/* ------------------------------------------------------------------ */

/**
 * Fulfillment provider ids are `${identifier}_${configured id}`, e.g.
 * `packeta_packeta` (no `fp_` prefix on the persisted id, unlike payment).
 */
export function isPacketaProviderId(providerId: string | null | undefined): boolean {
	return typeof providerId === "string" && /^(fp_)?packeta_/.test(providerId)
}

/**
 * Is this order/cart shipping method ours? Checks the linked shipping option's
 * provider and, as a fallback (link not expanded), the `option_id` our
 * `validateFulfillmentData` stamps into the method's `data`.
 */
export function isPacketaShippingMethod(
	m:
		| { shipping_option?: { provider_id?: string | null } | null; data?: Record<string, unknown> | null }
		| null
		| undefined,
): boolean {
	if (!m) return false
	if (isPacketaProviderId(m.shipping_option?.provider_id)) return true
	return typeof m.data?.option_id === "string" && m.data.option_id.startsWith("packeta")
}

export const OPTION_PICKUP = "packeta-pickup"
export const OPTION_HOME_DELIVERY = "packeta-home-delivery"
export const OPTION_RETURN = "packeta-return"
export const OPTION_CARRIER_PREFIX = "packeta-carrier-"

export interface PacketaFulfillmentOption {
	id: string
	name: string
	is_return?: boolean
	/** Set on per-carrier options. */
	carrier_id?: string
	country?: string
	pickup_points?: boolean
	disallows_cod?: boolean
	requires_phone?: boolean
	requires_email?: boolean
	requires_size?: boolean
	max_weight?: number
	currency?: string
	[k: string]: unknown
}

/* ------------------------------------------------------------------ */
/* Shipping-method `data` contract (storefront → validateFulfillmentData) */
/* ------------------------------------------------------------------ */

export interface PacketaPointSnapshot {
	/** Internal branch id (Packeta PUDO / Z-BOX). */
	id?: string
	name?: string
	street?: string
	city?: string
	zip?: string
	/** ISO 3166-1 alpha-2, lower or upper case. */
	country?: string
	/** "zbox" or "" for Packeta internal points. */
	group?: string
	/** External carrier id + its pickup point code. */
	carrier_id?: string
	carrier_pickup_point_id?: string
	type?: "internal" | "external"
}

export interface PacketaAddressSnapshot {
	street?: string
	house_number?: string
	city?: string
	zip?: string
	country?: string
	region?: string
}

/** What the storefront passes in `addShippingMethod({ data })`. */
export interface PacketaShippingMethodInput {
	point_id?: string
	carrier_id?: string
	carrier_pickup_point_id?: string
	point?: PacketaPointSnapshot
	address?: PacketaAddressSnapshot
	note?: string
}

export type PacketaKind = "pickup" | "hd" | "return"

/** Normalised output of `validateFulfillmentData`, stored on the shipping method. */
export interface PacketaFulfillmentData extends Record<string, unknown> {
	kind: PacketaKind
	option_id: string
	point_id?: string
	carrier_id?: string
	carrier_pickup_point_id?: string
	point?: PacketaPointSnapshot
	address?: PacketaAddressSnapshot
	note?: string
}

/** `fulfillment.data` after `createFulfillment` / `createReturnFulfillment`. */
export interface PacketaPacketData extends PacketaFulfillmentData {
	packet_id: string
	barcode: string
	barcode_text?: string
	number: string
	cod: number
	currency: string
	value: number
	weight_kg: number
	created_at: string
	tracking_url: string
	/** Return claims only. */
	password?: string
	cancelled_at?: string
}

/** `additional_data` accepted by `createFulfillment` (from the admin "create packet" flow). */
export interface PacketaAdditionalData {
	cod?: boolean
	cod_amount?: number
	/** Insured value of this packet (defaults to the order total). */
	value?: number
	weight_kg?: number
	note?: string
	eshop?: string
	number_prefix?: string
	number?: string
	deliver_on?: string
	adult_content?: boolean
	size?: PacketaSize
	/** Packet-level customs attributes (merged over the option defaults). */
	customs?: Record<string, string | number | boolean>
	/** Explicit customs items; when omitted they are derived from the order lines. */
	customs_items?: PacketaAttribute[][]
	/** Carrier services (comma separated ids/codes) — see Packeta "carrier services". */
	carrier_service?: string
}

/* ------------------------------------------------------------------ */
/* Packeta API shapes                                                  */
/* ------------------------------------------------------------------ */

export interface PacketAttributes {
	number: string
	name: string
	surname: string
	company?: string
	email?: string
	phone?: string
	addressId: string
	currency?: string
	cod?: number
	value: number
	weight: number
	deliverOn?: string
	eshop?: string
	adultContent?: boolean
	note?: string
	street?: string
	houseNumber?: string
	city?: string
	province?: string
	zip?: string
	carrierPickupPoint?: string
	carrierService?: string
	size?: PacketaSize
	/** Packet-level attributes (customs: ead, deliveryCost, invoiceNumber, …). */
	attributes?: PacketaAttribute[]
	/** Packet content items, each a list of attributes (customsCode, countryOfOrigin, value, unitsCount, weight, productNameEn, …). */
	items?: PacketaAttribute[][]
}

export interface PacketaSize {
	length: number
	width: number
	height: number
}

export interface PacketaAttribute {
	key: string
	value: string | number | boolean
}

export interface PacketCourierNumberV2Result {
	courierNumber: string
	carrierId?: number
	carrierName?: string
}

export interface PacketIdDetail {
	id: string
	barcode: string
	barcodeText?: string
}

export interface PacketDetail extends PacketIdDetail {
	password: string
}

export interface ClaimWithPasswordAttributes {
	number: string
	email?: string
	phone?: string
	value: number
	currency?: string
	eshop: string
	consignCountry?: string
	sendEmailToCustomer?: boolean
}

export interface StatusRecord {
	dateTime: string
	statusCode: number
	codeText: string
	statusText: string
	branchId?: number
	destinationBranchId?: number
	externalTrackingCode?: string
}

export interface CurrentStatusRecord extends StatusRecord {
	isReturning?: boolean
	storedUntil?: string
	carrierId?: number
	carrierName?: string
}

export interface PacketaCarrier {
	id: string
	name: string
	available: boolean
	pickupPoints: boolean
	apiAllowed: boolean
	separateHouseNumber: boolean
	customsDeclarations: boolean
	requiresEmail: boolean
	requiresPhone: boolean
	requiresSize: boolean
	disallowsCod: boolean
	/** lower-case ISO 3166-1 alpha-2 */
	country: string
	currency: string
	maxWeight: number
	labelRouting?: string
	labelName?: string
}

/** Push-tracking payloads. */
export interface PacketaPushStatus {
	eventId: string
	id: number | string
	barcode: string
	dateTime: string
	branchId?: number | null
	statusId: number
	statusCode: string
	statusText: string
	externalTrackingCode?: string | null
	destinationBranchId?: number | null
}

export interface PacketaPushExternalStatus {
	eventId: string
	id: number | string
	barcode: string
	dateTime: string
	branchId?: number | null
	externalStatusId: string
	externalStatusCode?: string | null
	externalStatusText?: string | null
	externalTrackingCode?: string | null
}

export type PacketaPushEvent = { status: PacketaPushStatus } | { externalStatus: PacketaPushExternalStatus }
