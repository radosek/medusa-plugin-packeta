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
import {
	buildRequest,
	child,
	childText,
	childrenNamed,
	flat,
	parseXml,
	type XmlElement,
	type XmlNode,
} from "./xml"

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
		return idDetail(result)
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
		return result.text.trim()
	}

	/** Base64-encoded PDF with one label per packet. */
	async packetsLabelsPdf(packetIds: string[], format: PacketaLabelFormat, offset = 0): Promise<string> {
		const result = await this.call("packetsLabelsPdf", { packetIds: { id: packetIds }, format, offset })
		return result.text.trim()
	}

	/** ZPL label (unescaped, ready to send to the printer). Format A6 (default) or A7 where supported. */
	async packetLabelZpl(packetId: string, dpi: PacketaZplDpi = 203, format = "A6"): Promise<string> {
		const result = await this.call("packetLabelZpl", { packetId, format, dpi })
		return result.text.trim()
	}

	/** External carrier's number for a packet (needed for direct carrier labels). */
	async packetCourierNumberV2(packetId: string): Promise<PacketCourierNumberV2Result> {
		const result = await this.call("packetCourierNumberV2", { packetId })
		const f = flat(result)
		return {
			courierNumber: f.courierNumber ?? result.text.trim(),
			carrierId: f.carrierId ? Number(f.carrierId) : undefined,
			carrierName: f.carrierName || undefined,
		}
	}

	/** Base64 PDF of the external carrier's own label (carrier must be `apiAllowed`). */
	async packetCourierLabelPdf(packetId: string, courierNumber: string): Promise<string> {
		const result = await this.call("packetCourierLabelPdf", { packetId, courierNumber })
		return result.text.trim()
	}

	/** ZPL of the external carrier's own label. */
	async packetCourierLabelZpl(
		packetId: string,
		courierNumber: string,
		dpi: PacketaZplDpi = 203,
	): Promise<string> {
		const result = await this.call("packetCourierLabelZpl", { packetId, courierNumber, dpi })
		return result.text.trim()
	}

	async packetStatus(packetId: string): Promise<CurrentStatusRecord> {
		const result = await this.call("packetStatus", { packetId })
		return toCurrentStatus(flat(result))
	}

	async packetTracking(packetId: string): Promise<StatusRecord[]> {
		const result = await this.call("packetTracking", { packetId })
		const records = childrenNamed(result, "record")
		const flats = records.length ? records.map(flat) : [flat(result)].filter((f) => f.statusCode)
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
		return { ...idDetail(result), password: childText(result, "password") ?? "" }
	}

	/** Parsed `<result>` of `packetInfo` (courier numbers, tracking urls, consign password). */
	async packetInfo(packetId: string): Promise<XmlElement> {
		return this.call("packetInfo", { packetId })
	}

	/**
	 * Perform one API call and return the parsed `<result>` element (an empty
	 * element for void methods). Throws `PacketaError` on `<status>fault</status>`.
	 */
	protected async call(method: string, args: XmlNode): Promise<XmlElement> {
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
		// The envelope is <response><status>…</status>…</response>; read direct
		// children only so nested payloads can never be mistaken for the envelope.
		const envelope = parseXml(xml)
		const status = childText(envelope, "status")
		if (status === "ok") {
			return child(envelope, "result") ?? { name: "result", children: [], text: "" }
		}
		const fault = childText(envelope, "fault") ?? (res.ok ? "UnknownFault" : `HTTP ${res.status}`)
		const message =
			childText(envelope, "string") ??
			(xml
				? xml
						.replace(/<[^>]+>/g, " ")
						.replace(/\s+/g, " ")
						.trim()
						.slice(0, 300)
				: res.statusText)
		const detail = child(envelope, "detail")
		throw new PacketaError(
			method,
			fault,
			this.redact(message),
			parseAttributeFaults(detail).map((a) => ({ name: a.name, fault: this.redact(a.fault) })),
		)
	}

	private redact(s: string): string {
		return this.apiPassword ? s.split(this.apiPassword).join("[REDACTED]") : s
	}
}

/**
 * `<detail><attributes><fault><name>zip</name><fault>…</fault></fault>…</attributes></detail>`
 * The inner element is also called `fault`; walk the tree so element order and
 * nesting cannot confuse the reader. `PacketIdsFault` lists bare `<id>` values.
 */
export function parseAttributeFaults(detail: XmlElement | string | undefined): PacketaAttributeFault[] {
	const el = typeof detail === "string" ? parseXml(`<detail>${detail}</detail>`) : detail
	if (!el) return []
	const out: PacketaAttributeFault[] = []
	const attributes = child(el, "attributes") ?? el
	for (const f of childrenNamed(attributes, "fault")) {
		const name = childText(f, "name")
		const fault = childText(f, "fault")
		if (name || fault) out.push({ name: name ?? "", fault: fault ?? "" })
	}
	if (!out.length) {
		const ids = child(el, "ids") ?? el
		for (const id of childrenNamed(ids, "id")) out.push({ name: "id", fault: id.text.trim() })
	}
	return out
}

function idDetail(result: XmlElement): PacketIdDetail {
	const id = childText(result, "id")
	if (!id) throw new PacketaError("response", "MalformedResponse", "missing <id> in result")
	return {
		id,
		barcode: childText(result, "barcode") ?? `Z${id}`,
		barcodeText: childText(result, "barcodeText"),
	}
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
