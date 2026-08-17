import { AbstractFulfillmentProviderService, MedusaError } from "@medusajs/framework/utils"
import type {
	CalculatedShippingOptionPrice,
	CalculateShippingOptionPriceDTO,
	CreateFulfillmentResult,
	CreateShippingOptionDTO,
	FulfillmentDTO,
	FulfillmentItemDTO,
	FulfillmentOption,
	FulfillmentOrderDTO,
	Logger,
	ValidateFulfillmentDataContext,
} from "@medusajs/framework/types"
import { PacketaClient, PacketaError } from "./lib/client"
import { PacketaFeed } from "./lib/feed"
import { buildPacketAttributes, currencyForCountry, round2, trackingUrl } from "./lib/packet"
import { validatePickupPoint } from "./lib/widget-validate"
import {
	OPTION_CARRIER_PREFIX,
	OPTION_HOME_DELIVERY,
	OPTION_PICKUP,
	OPTION_RETURN,
	PACKETA_LABEL_FORMATS,
	resolveOptions,
	type PacketaAdditionalData,
	type PacketaAddressSnapshot,
	type PacketaCarrier,
	type PacketaFulfillmentData,
	type PacketaFulfillmentOption,
	type PacketaKind,
	type PacketaLabelFormat,
	type PacketaOptions,
	type PacketaPacketData,
	type PacketaPointSnapshot,
	type PacketaShippingMethodInput,
	type ResolvedPacketaOptions,
} from "./types"

type InjectedDependencies = {
	logger: Logger
}

const OPTION_ID_RE = /^packeta-carrier-(\d+)$/

/**
 * Packeta (Zásilkovna) fulfillment provider. Registered as `packeta_packeta`
 * (fulfillment provider ids are `${identifier}_${config id}`).
 *
 * Providers run inside the Fulfillment Module's container (no `query`), so
 * this class is a pure mapping layer between Medusa DTOs and the Packeta API.
 * Cross-module concerns (COD detection, packet records, status sync) live in
 * the plugin's workflows and subscribers.
 */
class PacketaProviderService extends AbstractFulfillmentProviderService {
	static identifier = "packeta"

	protected readonly options_: ResolvedPacketaOptions
	protected readonly client_: PacketaClient
	protected readonly feed_: PacketaFeed
	protected readonly logger_: Logger

	static validateOptions(options: PacketaOptions): void {
		validatePacketaOptions(options)
	}

	constructor(container: InjectedDependencies, options: PacketaOptions) {
		super()
		this.options_ = resolveOptions(options)
		this.logger_ = container.logger
		this.client_ = new PacketaClient(this.options_)
		this.feed_ = new PacketaFeed(this.options_)
	}

	/* ---------------------------------------------------------------- */
	/* Fulfillment options                                               */
	/* ---------------------------------------------------------------- */

	async getFulfillmentOptions(): Promise<FulfillmentOption[]> {
		const options: PacketaFulfillmentOption[] = [
			{ id: OPTION_PICKUP, name: "Packeta pickup point" },
			{ id: OPTION_HOME_DELIVERY, name: "Packeta home delivery" },
			{ id: OPTION_RETURN, name: "Packeta return (claim assistant)", is_return: true },
		]
		if (!this.options_.expose_carriers) return options
		let carriers: PacketaCarrier[] = []
		try {
			carriers = await this.feed_.carriers()
		} catch (e) {
			this.logger_.warn(
				`Packeta: carrier feed unavailable, exposing static options only (${(e as Error).message})`,
			)
			return options
		}
		const enabled = this.options_.enabled_carriers
		for (const c of carriers) {
			if (!c.available) continue
			if (enabled !== "all" && !enabled.includes(c.id)) continue
			options.push({
				id: `${OPTION_CARRIER_PREFIX}${c.id}`,
				name: c.name,
				carrier_id: c.id,
				country: c.country,
				pickup_points: c.pickupPoints,
				disallows_cod: c.disallowsCod,
				requires_phone: c.requiresPhone,
				requires_email: c.requiresEmail,
				requires_size: c.requiresSize,
				max_weight: c.maxWeight,
				currency: c.currency,
			})
		}
		return options
	}

	async validateOption(data: Record<string, unknown>): Promise<boolean> {
		const id = String(data.id ?? "")
		return (
			id === OPTION_PICKUP || id === OPTION_HOME_DELIVERY || id === OPTION_RETURN || OPTION_ID_RE.test(id)
		)
	}

	async canCalculate(_data: CreateShippingOptionDTO): Promise<boolean> {
		return false
	}

	async calculatePrice(
		_optionData: CalculateShippingOptionPriceDTO["optionData"],
		_data: CalculateShippingOptionPriceDTO["data"],
		_context: CalculateShippingOptionPriceDTO["context"],
	): Promise<CalculatedShippingOptionPrice> {
		throw new MedusaError(MedusaError.Types.NOT_ALLOWED, "Packeta shipping options use flat prices.")
	}

	/* ---------------------------------------------------------------- */
	/* Checkout: validate what the storefront selected                   */
	/* ---------------------------------------------------------------- */

	async validateFulfillmentData(
		optionData: Record<string, unknown>,
		data: Record<string, unknown>,
		context: ValidateFulfillmentDataContext,
	): Promise<PacketaFulfillmentData> {
		const optionId = String(optionData.id ?? "")
		const input = (data ?? {}) as PacketaShippingMethodInput & Record<string, unknown>
		const carrierOption = OPTION_ID_RE.test(optionId) ? await this.carrierFromOption(optionData) : undefined
		const kind = this.kindForOption(optionId, carrierOption)
		const shippingAddress = context?.shipping_address ?? undefined
		const country = String(shippingAddress?.country_code ?? input.point?.country ?? "").toLowerCase()

		if (kind === "return") {
			return { ...stripKnown(input), kind, option_id: optionId }
		}

		if (kind === "pickup") {
			return this.validatePickup(optionId, input, carrierOption, country)
		}

		// Home delivery
		let carrierId = carrierOption?.id ?? (input.carrier_id ? String(input.carrier_id) : undefined)
		if (!carrierId) {
			if (!country) {
				throw new MedusaError(
					MedusaError.Types.INVALID_DATA,
					"Packeta home delivery needs a shipping address country to pick a carrier.",
				)
			}
			const carrier = await this.feed_.homeDeliveryCarrier(country)
			if (!carrier) {
				throw new MedusaError(
					MedusaError.Types.INVALID_DATA,
					`Packeta has no home-delivery carrier for country "${country.toUpperCase()}".`,
				)
			}
			carrierId = carrier.id
		}
		const address = normaliseAddress(input.address)
		if (!address && !(shippingAddress?.address_1 && shippingAddress?.city && shippingAddress?.postal_code)) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				"Packeta home delivery needs a shipping address (street, city, postal code).",
			)
		}
		return {
			...stripKnown(input),
			kind: "hd",
			option_id: optionId,
			carrier_id: carrierId,
			address,
			note: strOrUndef(input.note),
		}
	}

	private async validatePickup(
		optionId: string,
		input: PacketaShippingMethodInput,
		carrierOption: PacketaCarrier | undefined,
		country: string,
	): Promise<PacketaFulfillmentData> {
		const snap = normalisePoint(input.point)
		const pointId = strOrUndef(input.point_id) ?? snap?.id
		const carrierId = strOrUndef(input.carrier_id) ?? snap?.carrier_id
		const carrierPointId = strOrUndef(input.carrier_pickup_point_id) ?? snap?.carrier_pickup_point_id

		const external = !!(carrierId && carrierPointId)
		if (!external && !pointId) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				"Packeta pickup needs `point_id` (Packeta point) or `carrier_id` + `carrier_pickup_point_id` (carrier point).",
			)
		}
		if (carrierOption) {
			if (!external || carrierId !== carrierOption.id) {
				throw new MedusaError(
					MedusaError.Types.INVALID_DATA,
					`Selected pickup point does not belong to carrier ${carrierOption.name} (${carrierOption.id}).`,
				)
			}
		}

		let point: PacketaPointSnapshot = {
			...snap,
			id: external ? undefined : pointId,
			carrier_id: external ? carrierId : undefined,
			carrier_pickup_point_id: external ? carrierPointId : undefined,
			type: external ? "external" : "internal",
		}

		if (this.options_.validate_pickup_point) {
			const result = await validatePickupPoint(
				this.options_,
				external ? { carrierId, carrierPickupPointId: carrierPointId } : { id: pointId },
				carrierOption ? { carriers: carrierOption.id } : {},
			).catch((e: Error) => {
				this.logger_.warn(`Packeta: pickup point validation unavailable (${e.message}); accepting selection.`)
				return undefined
			})
			if (result) {
				if (!result.isValid) {
					const why = result.errors.map((e) => e.description || e.code).join("; ") || "unknown reason"
					throw new MedusaError(MedusaError.Types.INVALID_DATA, `Packeta pickup point rejected: ${why}`)
				}
				const vp = result.point
				point = {
					...point,
					name: point.name ?? vp?.name,
					street: point.street ?? vp?.address?.street,
					city: point.city ?? vp?.address?.city?.trim(),
					zip: point.zip ?? vp?.address?.zip,
					country: point.country ?? vp?.address?.country ?? vp?.country,
					group: point.group ?? vp?.group,
					carrier_id: point.carrier_id ?? vp?.carrierId,
				}
			}
		}
		if (!point.country && country) point.country = country

		return {
			...stripKnown(input as PacketaShippingMethodInput & Record<string, unknown>),
			kind: "pickup",
			option_id: optionId,
			point_id: external ? undefined : pointId,
			carrier_id: external ? carrierId : undefined,
			carrier_pickup_point_id: external ? carrierPointId : undefined,
			point,
			note: strOrUndef(input.note),
		}
	}

	private kindForOption(optionId: string, carrier: PacketaCarrier | undefined): PacketaKind {
		if (optionId === OPTION_RETURN) return "return"
		if (optionId === OPTION_PICKUP) return "pickup"
		if (optionId === OPTION_HOME_DELIVERY) return "hd"
		if (carrier) return carrier.pickupPoints ? "pickup" : "hd"
		throw new MedusaError(MedusaError.Types.INVALID_DATA, `Unknown Packeta fulfillment option "${optionId}".`)
	}

	private async carrierFromOption(optionData: Record<string, unknown>): Promise<PacketaCarrier | undefined> {
		const id = String(optionData.carrier_id ?? String(optionData.id ?? "").match(OPTION_ID_RE)?.[1] ?? "")
		if (!id) return undefined
		const fromFeed = await this.feed_.carrier(id).catch(() => undefined)
		if (fromFeed) return fromFeed
		// Feed down: fall back to what was stored on the option at creation time.
		return {
			id,
			name: String(optionData.name ?? `Carrier ${id}`),
			available: true,
			pickupPoints: !!optionData.pickup_points,
			apiAllowed: false,
			separateHouseNumber: false,
			customsDeclarations: false,
			requiresEmail: !!optionData.requires_email,
			requiresPhone: !!optionData.requires_phone,
			requiresSize: !!optionData.requires_size,
			disallowsCod: !!optionData.disallows_cod,
			country: String(optionData.country ?? "").toLowerCase(),
			currency: String(optionData.currency ?? ""),
			maxWeight: Number(optionData.max_weight ?? 0) || 0,
		}
	}

	/* ---------------------------------------------------------------- */
	/* Fulfillment: create the packet                                    */
	/* ---------------------------------------------------------------- */

	async createFulfillment(
		data: Record<string, unknown>,
		items: Partial<Omit<FulfillmentItemDTO, "fulfillment">>[],
		order: Partial<FulfillmentOrderDTO> | undefined,
		fulfillment: Partial<Omit<FulfillmentDTO, "provider_id" | "data" | "items">>,
		additionalData?: Record<string, unknown>,
	): Promise<CreateFulfillmentResult> {
		const fData = data as PacketaFulfillmentData
		if (fData.kind === "return") {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				"Use a return shipping option to create Packeta return packets.",
			)
		}
		const additional = (additionalData?.packeta ?? additionalData ?? {}) as PacketaAdditionalData
		const carrier = fData.carrier_id
			? await this.feed_.carrier(fData.carrier_id).catch(() => undefined)
			: undefined
		const built = buildPacketAttributes({
			order,
			items,
			data: fData,
			additional,
			options: this.options_,
			carrier,
			fallbackNumber: (fulfillment.id as string | undefined) ?? "order",
		})

		if (built.cod.cod > 0 && carrier?.disallowsCod) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				`Carrier ${carrier.name} does not allow cash on delivery; create the packet without COD.`,
			)
		}
		if (carrier?.requiresSize && !built.attributes.size) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				`Carrier ${carrier.name} requires packet dimensions; pass \`size\` ({ length, width, height } in mm) or set the \`default_size\` option.`,
			)
		}
		if (carrier?.maxWeight && built.weightKg > carrier.maxWeight) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				`Packet weight ${built.weightKg} kg exceeds carrier ${carrier.name} limit of ${carrier.maxWeight} kg.`,
			)
		}
		if (!built.attributes.addressId) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				"Packeta: missing destination (pickup point or carrier).",
			)
		}

		let created
		try {
			created = await this.client_.createPacket(built.attributes)
		} catch (e) {
			throw toMedusaError(e)
		}
		const url = trackingUrl(this.options_.tracking_url, created.barcode, created.id)
		const packetData: PacketaPacketData = {
			...fData,
			address: built.address ?? fData.address,
			packet_id: created.id,
			barcode: created.barcode,
			barcode_text: created.barcodeText,
			number: built.number,
			cod: built.cod.cod,
			currency: built.currency,
			value: built.value,
			weight_kg: built.weightKg,
			created_at: new Date().toISOString(),
			tracking_url: url,
		}
		return {
			data: packetData,
			labels: [
				{
					tracking_number: created.barcode,
					tracking_url: url,
					label_url: labelUrl(created.id),
				},
			],
		}
	}

	async cancelFulfillment(data: Record<string, unknown>): Promise<Record<string, unknown>> {
		const pData = data as Partial<PacketaPacketData>
		if (!pData.packet_id) return { ...data }
		if (pData.cancelled_at) return { ...data }
		try {
			await this.client_.cancelPacket(pData.packet_id)
		} catch (e) {
			if (e instanceof PacketaError && e.fault === "PacketIdFault") {
				// Already gone on Packeta's side.
				return { ...data, cancelled_at: new Date().toISOString() }
			}
			throw toMedusaError(e)
		}
		return { ...data, cancelled_at: new Date().toISOString() }
	}

	/* ---------------------------------------------------------------- */
	/* Returns: claim assistant packet                                   */
	/* ---------------------------------------------------------------- */

	async createReturnFulfillment(fulfillment: Record<string, unknown>): Promise<CreateFulfillmentResult> {
		const f = fulfillment as {
			id?: string
			order_id?: string
			data?: Record<string, unknown>
			delivery_address?: {
				first_name?: string
				last_name?: string
				phone?: string
				country_code?: string
			} | null
			metadata?: Record<string, unknown> | null
			shipping_option?: { data?: Record<string, unknown> } | null
		}
		const d = (f.data ?? {}) as Record<string, unknown>
		const meta = (f.metadata ?? {}) as Record<string, unknown>
		const country = String(d.country ?? f.delivery_address?.country_code ?? "").toLowerCase() || undefined
		const email = strOrUndef(d.email) ?? strOrUndef(meta.email)
		const phone = strOrUndef(d.phone) ?? strOrUndef(f.delivery_address?.phone)
		if (!email && !phone) {
			throw new MedusaError(
				MedusaError.Types.INVALID_DATA,
				"Packeta return needs the customer's email or phone (pass `email`/`phone` in the return shipping data).",
			)
		}
		const rawValue = Number(d.value ?? meta.value)
		const value =
			Number.isFinite(rawValue) && rawValue > 0 ? round2(rawValue) : this.options_.return_value_default
		const currency = strOrUndef(d.currency)?.toUpperCase() ?? currencyForCountry(country)
		const number =
			strOrUndef(d.number) ??
			`RET-${(f.order_id ?? f.id ?? "")
				.toString()
				.replace(/^order_/, "")
				.slice(0, 30)}`

		let claim
		try {
			claim = await this.client_.createPacketClaimWithPassword({
				number,
				email,
				phone,
				value,
				currency,
				eshop: strOrUndef(d.eshop) ?? this.options_.eshop,
				consignCountry: country,
				sendEmailToCustomer: !!email && d.send_email !== false,
			})
		} catch (e) {
			throw toMedusaError(e)
		}
		const url = trackingUrl(this.options_.tracking_url, claim.barcode, claim.id)
		const packetData: PacketaPacketData = {
			...(d as Partial<PacketaFulfillmentData>),
			kind: "return",
			option_id: String(d.option_id ?? OPTION_RETURN),
			packet_id: claim.id,
			barcode: claim.barcode,
			barcode_text: claim.barcodeText,
			password: claim.password,
			number,
			cod: 0,
			currency,
			value,
			weight_kg: 0,
			created_at: new Date().toISOString(),
			tracking_url: url,
		}
		return {
			data: packetData,
			labels: [{ tracking_number: claim.barcode, tracking_url: url, label_url: labelUrl(claim.id) }],
		}
	}

	/* ---------------------------------------------------------------- */
	/* Documents                                                          */
	/* ---------------------------------------------------------------- */

	async getFulfillmentDocuments(data: Record<string, unknown>): Promise<never[]> {
		return (await this.labelDocuments(data)) as never[]
	}

	async getShipmentDocuments(data: Record<string, unknown>): Promise<never[]> {
		return (await this.labelDocuments(data)) as never[]
	}

	async getReturnDocuments(data: Record<string, unknown>): Promise<never[]> {
		return (await this.labelDocuments(data)) as never[]
	}

	async retrieveDocuments(fulfillmentData: Record<string, unknown>, documentType: string): Promise<void> {
		if (documentType && documentType !== "label") return undefined
		return (await this.labelDocuments(fulfillmentData)) as unknown as void
	}

	private async labelDocuments(
		data: Record<string, unknown>,
	): Promise<{ type: string; format: string; base64: string; filename: string }[]> {
		const pData = data as Partial<PacketaPacketData>
		if (!pData.packet_id) return []
		const base64 = await this.client_
			.packetLabelPdf(pData.packet_id, this.options_.label_format)
			.catch((e) => {
				throw toMedusaError(e)
			})
		return [
			{ type: "label", format: "pdf", base64, filename: `packeta-${pData.barcode ?? pData.packet_id}.pdf` },
		]
	}

	/* ---------------------------------------------------------------- */
	/* Accessors used by tests / smoke                                    */
	/* ---------------------------------------------------------------- */

	get client(): PacketaClient {
		return this.client_
	}

	get feed(): PacketaFeed {
		return this.feed_
	}

	get options(): ResolvedPacketaOptions {
		return this.options_
	}
}

export function validatePacketaOptions(options: PacketaOptions): void {
	if (!options?.api_password) {
		throw new MedusaError(
			MedusaError.Types.INVALID_DATA,
			"Packeta provider requires the `api_password` option.",
		)
	}
	if (!/^[0-9a-f]{32}$/i.test(options.api_password)) {
		throw new MedusaError(
			MedusaError.Types.INVALID_DATA,
			"Packeta `api_password` must be the 32-character hex API password (not the 16-character API key).",
		)
	}
	if (!options.api_key) {
		throw new MedusaError(MedusaError.Types.INVALID_DATA, "Packeta provider requires the `api_key` option.")
	}
	if (!options.eshop) {
		throw new MedusaError(
			MedusaError.Types.INVALID_DATA,
			"Packeta provider requires the `eshop` (sender indication) option.",
		)
	}
	if (options.label_format && !PACKETA_LABEL_FORMATS.includes(options.label_format as PacketaLabelFormat)) {
		throw new MedusaError(
			MedusaError.Types.INVALID_DATA,
			`Packeta \`label_format\` must be one of: ${PACKETA_LABEL_FORMATS.join(", ")}.`,
		)
	}
}

export function labelUrl(packetId: string): string {
	return `/admin/packeta/packets/${encodeURIComponent(packetId)}/label`
}

export function toMedusaError(e: unknown): MedusaError {
	if (e instanceof MedusaError) return e
	if (e instanceof PacketaError) {
		const type =
			e.fault === "IncorrectApiPasswordFault"
				? MedusaError.Types.UNAUTHORIZED
				: e.fault === "PacketAttributesFault" ||
					  e.fault === "PacketIdFault" ||
					  e.fault === "CancelNotAllowedFault"
					? MedusaError.Types.INVALID_DATA
					: MedusaError.Types.UNEXPECTED_STATE
		return new MedusaError(type, e.message)
	}
	return new MedusaError(MedusaError.Types.UNEXPECTED_STATE, (e as Error)?.message ?? String(e))
}

function normalisePoint(p: unknown): PacketaPointSnapshot | undefined {
	if (!p || typeof p !== "object") return undefined
	const o = p as Record<string, unknown>
	const out: PacketaPointSnapshot = {
		id: strOrUndef(o.id),
		name: strOrUndef(o.name),
		street: strOrUndef(o.street),
		city: strOrUndef(o.city),
		zip: strOrUndef(o.zip),
		country: strOrUndef(o.country)?.toLowerCase(),
		group: strOrUndef(o.group),
		carrier_id: strOrUndef(o.carrier_id ?? o.carrierId),
		carrier_pickup_point_id: strOrUndef(o.carrier_pickup_point_id ?? o.carrierPickupPointId),
		type:
			o.type === "external" || o.pickupPointType === "external"
				? "external"
				: o.type === "internal" || o.pickupPointType === "internal"
					? "internal"
					: undefined,
	}
	return out
}

function normaliseAddress(a: unknown): PacketaAddressSnapshot | undefined {
	if (!a || typeof a !== "object") return undefined
	const o = a as Record<string, unknown>
	const street = strOrUndef(o.street)
	const city = strOrUndef(o.city)
	const zip = strOrUndef(o.zip ?? o.postcode ?? o.postal_code)
	if (!street || !city || !zip) return undefined
	return {
		street,
		house_number: strOrUndef(o.house_number ?? o.houseNumber),
		city,
		zip: zip.replace(/\s+/g, ""),
		country: strOrUndef(o.country)?.toLowerCase(),
		region: strOrUndef(o.region ?? o.province),
	}
}

function strOrUndef(v: unknown): string | undefined {
	if (v === undefined || v === null) return undefined
	const s = String(v).trim()
	return s ? s : undefined
}

/** Keep unknown keys the storefront passed (forward compatible), drop the ones we normalise. */
function stripKnown(input: Record<string, unknown>): Record<string, unknown> {
	const {
		point_id: _p,
		carrier_id: _c,
		carrier_pickup_point_id: _cp,
		point: _pt,
		address: _a,
		note: _n,
		...rest
	} = input
	return rest
}

export default PacketaProviderService
export { PacketaProviderService }
