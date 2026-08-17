import type {
	ClaimWithPasswordAttributes,
	PacketaAttribute,
	CurrentStatusRecord,
	PacketAttributes,
	PacketDetail,
	PacketIdDetail,
	PacketaLabelFormat,
	PacketaOptions,
	PacketaZplDpi,
	PacketCourierNumberV2Result,
	StatusRecord,
} from "../types"
import { PACKETA_DEFAULTS } from "../types"
import { buildRequest, readBlock, readBlocks, readFlat, readTag, unescapeXml, type XmlNode } from "./xml"

export interface PacketaAttributeFault {
	name: string
	fault: string
}

export class PacketaError extends Error {
	/** Packeta fault class, e.g. `PacketAttributesFault`, `IncorrectApiPasswordFault`. */
	fault: string
	/** Per-attribute details for `PacketAttributesFault`. */
	attributes: PacketaAttributeFault[]
	method: string

	constructor(method: string, fault: string, message: string, attributes: PacketaAttributeFault[] = []) {
		const detail = attributes.length ? ` :: ${attributes.map((a) => `${a.name}: ${a.fault}`).join("; ")}` : ""
		super(`Packeta ${method} failed (${fault}): ${message}${detail}`)
		this.name = "PacketaError"
		this.fault = fault
		this.method = method
		this.attributes = attributes
	}
}

type ClientOptions = Pick<PacketaOptions, "api_password" | "base_url">

/**
 * Client for the Packeta REST/XML API (`https://www.zasilkovna.cz/api/rest`).
 *
 * Every request is `POST` with an XML body whose root element is the method
 * name and whose first child is `<apiPassword>`. Responses are
 * `<response><status>ok|fault</status>…</response>`; `ok` carries `<result>`,
 * `fault` carries `<fault>`, `<string>` and optionally `<detail>`.
 */
export class PacketaClient {
	private readonly apiPassword: string
	private readonly baseUrl: string

	constructor(options: ClientOptions) {
		this.apiPassword = options.api_password
		this.baseUrl = options.base_url ?? PACKETA_DEFAULTS.base_url
	}

	async createPacket(attributes: PacketAttributes): Promise<PacketIdDetail> {
		const result = await this.call("createPacket", { packetAttributes: attrsToXml(attributes) })
		return {
			id: required(readTag(result, "id"), "id"),
			barcode: readTag(result, "barcode") ?? `Z${readTag(result, "id")}`,
			barcodeText: readTag(result, "barcodeText"),
		}
	}

	async packetAttributesValid(attributes: PacketAttributes): Promise<void> {
		await this.call("packetAttributesValid", { packetAttributes: attrsToXml(attributes) })
	}

	async cancelPacket(packetId: string): Promise<void> {
		await this.call("cancelPacket", { packetId })
	}

	/** Base64-encoded PDF. */
	async packetLabelPdf(packetId: string, format: PacketaLabelFormat, offset = 0): Promise<string> {
		const result = await this.call("packetLabelPdf", { packetId, format, offset })
		return result.trim()
	}

	/** Base64-encoded PDF with one label per packet. */
	async packetsLabelsPdf(packetIds: string[], format: PacketaLabelFormat, offset = 0): Promise<string> {
		const result = await this.call("packetsLabelsPdf", { packetIds: { id: packetIds }, format, offset })
		return result.trim()
	}

	/** ZPL label (unescaped, ready to send to the printer). Format A6 (default) or A7 where supported. */
	async packetLabelZpl(packetId: string, dpi: PacketaZplDpi = 203, format = "A6"): Promise<string> {
		const result = await this.call("packetLabelZpl", { packetId, format, dpi })
		return unescapeXml(result.trim())
	}

	/** External carrier's number for a packet (needed for direct carrier labels). */
	async packetCourierNumberV2(packetId: string): Promise<PacketCourierNumberV2Result> {
		const result = await this.call("packetCourierNumberV2", { packetId })
		const f = readFlat(result)
		return {
			courierNumber: f.courierNumber ?? result.trim(),
			carrierId: f.carrierId ? Number(f.carrierId) : undefined,
			carrierName: f.carrierName || undefined,
		}
	}

	/** Base64 PDF of the external carrier's own label (carrier must be `apiAllowed`). */
	async packetCourierLabelPdf(packetId: string, courierNumber: string): Promise<string> {
		const result = await this.call("packetCourierLabelPdf", { packetId, courierNumber })
		return result.trim()
	}

	/** ZPL of the external carrier's own label. */
	async packetCourierLabelZpl(
		packetId: string,
		courierNumber: string,
		dpi: PacketaZplDpi = 203,
	): Promise<string> {
		const result = await this.call("packetCourierLabelZpl", { packetId, courierNumber, dpi })
		return unescapeXml(result.trim())
	}

	async packetStatus(packetId: string): Promise<CurrentStatusRecord> {
		const result = await this.call("packetStatus", { packetId })
		return toCurrentStatus(readFlat(result))
	}

	async packetTracking(packetId: string): Promise<StatusRecord[]> {
		const result = await this.call("packetTracking", { packetId })
		const blocks = readBlocks(result, "record")
		const flats = blocks.length ? blocks.map(readFlat) : [readFlat(result)].filter((f) => f.statusCode)
		return flats.map(toStatus)
	}

	async createPacketClaimWithPassword(attributes: ClaimWithPasswordAttributes): Promise<PacketDetail> {
		const result = await this.call("createPacketClaimWithPassword", {
			claimWithPasswordAttributes: {
				number: attributes.number,
				email: attributes.email,
				phone: attributes.phone,
				value: attributes.value,
				currency: attributes.currency,
				eshop: attributes.eshop,
				consignCountry: attributes.consignCountry,
				sendEmailToCustomer: attributes.sendEmailToCustomer,
			},
		})
		return {
			id: required(readTag(result, "id"), "id"),
			barcode: readTag(result, "barcode") ?? `Z${readTag(result, "id")}`,
			barcodeText: readTag(result, "barcodeText"),
			password: readTag(result, "password") ?? "",
		}
	}

	/** Raw `<result>` XML for `packetInfo` (courier numbers, tracking urls, consign password). */
	async packetInfo(packetId: string): Promise<string> {
		return this.call("packetInfo", { packetId })
	}

	/**
	 * Perform one API call and return the inner XML of `<result>` (empty string
	 * for void methods). Throws `PacketaError` on `<status>fault</status>`.
	 */
	protected async call(method: string, args: XmlNode): Promise<string> {
		const body = buildRequest(method, this.apiPassword, args)
		let res: Response
		try {
			res = await fetch(this.baseUrl, {
				method: "POST",
				headers: { "Content-Type": "text/xml; charset=utf-8", Accept: "text/xml" },
				body,
			})
		} catch (e) {
			throw new PacketaError(method, "NetworkError", this.redact((e as Error).message))
		}
		const xml = await res.text()
		const status = readTag(xml, "status")
		if (status === "ok") {
			return readBlock(xml, "result") ?? ""
		}
		const fault = readTag(xml, "fault") ?? (res.ok ? "UnknownFault" : `HTTP ${res.status}`)
		const message =
			readTag(xml, "string") ??
			(xml
				? xml
						.replace(/<[^>]+>/g, " ")
						.replace(/\s+/g, " ")
						.trim()
						.slice(0, 300)
				: res.statusText)
		const detail = readBlock(xml, "detail") ?? ""
		throw new PacketaError(
			method,
			fault,
			this.redact(message),
			parseAttributeFaults(detail).map((a) => ({ ...a, fault: this.redact(a.fault) })),
		)
	}

	private redact(s: string): string {
		return this.apiPassword ? s.split(this.apiPassword).join("[REDACTED]") : s
	}
}

/**
 * `<detail><attributes><fault><name>zip</name><fault>…</fault></fault>…</attributes></detail>`
 * The inner element is also called `fault`, so read name/fault pairs in order
 * instead of nesting-unaware block extraction.
 */
export function parseAttributeFaults(detail: string): PacketaAttributeFault[] {
	const out: PacketaAttributeFault[] = []
	const re = /<name>([^<]*)<\/name>\s*<fault>([^<]*)<\/fault>/g
	let m: RegExpExecArray | null
	while ((m = re.exec(detail))) out.push({ name: unescapeXml(m[1].trim()), fault: unescapeXml(m[2].trim()) })
	if (!out.length) {
		// Some faults (PacketIdsFault) list bare <id> values instead.
		for (const id of readBlocks(detail, "id")) out.push({ name: "id", fault: unescapeXml(id.trim()) })
	}
	return out
}

function attrsToXml(a: PacketAttributes): XmlNode {
	return {
		number: a.number,
		name: a.name,
		surname: a.surname,
		company: a.company,
		email: a.email,
		phone: a.phone,
		addressId: a.addressId,
		currency: a.currency,
		cod: a.cod,
		value: a.value,
		weight: a.weight,
		deliverOn: a.deliverOn,
		eshop: a.eshop,
		adultContent: a.adultContent,
		note: a.note,
		street: a.street,
		houseNumber: a.houseNumber,
		city: a.city,
		province: a.province,
		zip: a.zip,
		carrierService: a.carrierService,
		carrierPickupPoint: a.carrierPickupPoint,
		size: a.size ? { length: a.size.length, width: a.size.width, height: a.size.height } : undefined,
		attributes: a.attributes?.length ? { attribute: a.attributes.map(attrToXml) } : undefined,
		items: a.items?.length
			? { item: a.items.map((attrs) => ({ attributes: { attribute: attrs.map(attrToXml) } })) }
			: undefined,
	}
}

function attrToXml(a: PacketaAttribute): XmlNode {
	return { key: a.key, value: typeof a.value === "boolean" ? (a.value ? "1" : "0") : String(a.value) }
}

function toStatus(f: Record<string, string>): StatusRecord {
	return {
		dateTime: f.dateTime ?? "",
		statusCode: Number(f.statusCode ?? 999),
		codeText: f.codeText ?? "",
		statusText: f.statusText ?? "",
		branchId: f.branchId ? Number(f.branchId) : undefined,
		destinationBranchId: f.destinationBranchId ? Number(f.destinationBranchId) : undefined,
		externalTrackingCode: f.externalTrackingCode || undefined,
	}
}

function toCurrentStatus(f: Record<string, string>): CurrentStatusRecord {
	return {
		...toStatus(f),
		isReturning: f.isReturning != null ? f.isReturning === "1" || f.isReturning === "true" : undefined,
		storedUntil: f.storedUntil || undefined,
		carrierId: f.carrierId ? Number(f.carrierId) : undefined,
		carrierName: f.carrierName || undefined,
	}
}

function required(v: string | undefined, name: string): string {
	if (!v) throw new PacketaError("response", "MalformedResponse", `missing <${name}> in result`)
	return v
}
