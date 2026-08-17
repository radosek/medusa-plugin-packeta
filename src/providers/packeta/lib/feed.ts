import type { PacketaCarrier, PacketaOptions } from "../types"
import { PACKETA_DEFAULTS } from "../types"

type FeedOptions = Pick<PacketaOptions, "api_key" | "feed_base_url" | "feed_ttl_s">

/**
 * Packeta carrier feed (v5), cached in memory. One instance per provider /
 * module; carriers change rarely (Packeta asks for at most one refresh a day).
 */
export class PacketaFeed {
	private readonly apiKey: string
	private readonly baseUrl: string
	private readonly ttlMs: number
	private cache: { at: number; carriers: PacketaCarrier[] } | null = null
	private inflight: Promise<PacketaCarrier[]> | null = null

	constructor(options: FeedOptions) {
		this.apiKey = options.api_key
		this.baseUrl = (options.feed_base_url ?? PACKETA_DEFAULTS.feed_base_url).replace(/\/$/, "")
		this.ttlMs = (options.feed_ttl_s ?? PACKETA_DEFAULTS.feed_ttl_s) * 1000
	}

	async carriers(lang = "en"): Promise<PacketaCarrier[]> {
		if (this.cache && Date.now() - this.cache.at < this.ttlMs) return this.cache.carriers
		if (this.inflight) return this.inflight
		this.inflight = this.fetchCarriers(lang)
			.then((carriers) => {
				this.cache = { at: Date.now(), carriers }
				return carriers
			})
			.finally(() => {
				this.inflight = null
			})
		return this.inflight
	}

	/** Cached carriers if any (even stale), else empty — never hits the network. */
	cached(): PacketaCarrier[] {
		return this.cache?.carriers ?? []
	}

	invalidate(): void {
		this.cache = null
	}

	async carrier(id: string | number): Promise<PacketaCarrier | undefined> {
		const list = await this.carriers()
		return list.find((c) => c.id === String(id))
	}

	/**
	 * Home-delivery carrier for a country. Prefers Packeta's own HD service
	 * (name contains Packeta / Zásilkovna / "HD" without an external brand),
	 * falls back to the first available HD carrier of that country.
	 */
	async homeDeliveryCarrier(countryCode: string): Promise<PacketaCarrier | undefined> {
		const cc = countryCode.toLowerCase()
		const list = (await this.carriers()).filter((c) => c.available && !c.pickupPoints && c.country === cc)
		return pickHomeDeliveryCarrier(list)
	}

	private async fetchCarriers(lang: string): Promise<PacketaCarrier[]> {
		const url = `${this.baseUrl}/${encodeURIComponent(this.apiKey)}/carrier/json?lang=${encodeURIComponent(lang)}`
		const res = await fetch(url, { headers: { Accept: "application/json" } })
		if (!res.ok) throw new Error(`Packeta carrier feed failed: HTTP ${res.status}`)
		const raw = (await res.json()) as unknown
		return parseCarriers(raw)
	}
}

const PACKETA_OWN = /packeta|zásilkovna|zasilkovna/i
const HOME_WORDS = /domů|domu|home\b|\bhd\b/i
/** City-specific evening / express / Saturday variants are opt-in, never the default. */
const SPECIAL = /večerní|vecerni|evening|express|expres|sobot|saturday|weekend|víkend|same.?day/i

/**
 * Pick the default home-delivery carrier out of a country's HD carriers:
 * Packeta's own plain "home" service first, then any Packeta-own service that
 * isn't a special variant, then any non-special carrier, then whatever is left.
 */
const label = (c: PacketaCarrier) => `${c.name} ${c.labelName ?? ""}`

export function pickHomeDeliveryCarrier(list: PacketaCarrier[]): PacketaCarrier | undefined {
	return (
		list.find((c) => PACKETA_OWN.test(label(c)) && HOME_WORDS.test(label(c)) && !SPECIAL.test(label(c))) ??
		list.find((c) => PACKETA_OWN.test(label(c)) && !SPECIAL.test(label(c))) ??
		list.find((c) => !SPECIAL.test(label(c))) ??
		list[0]
	)
}

/** Feed values are strings ("true"/"false"/"30"); normalise to typed. */
export function parseCarriers(raw: unknown): PacketaCarrier[] {
	const arr = Array.isArray(raw)
		? raw
		: raw && typeof raw === "object" && Array.isArray((raw as { carriers?: unknown }).carriers)
			? (raw as { carriers: unknown[] }).carriers
			: []
	return arr
		.filter((c): c is Record<string, unknown> => !!c && typeof c === "object")
		.map((c) => ({
			id: String(c.id ?? ""),
			name: String(c.name ?? ""),
			available: bool(c.available, true),
			pickupPoints: bool(c.pickupPoints),
			apiAllowed: bool(c.apiAllowed),
			separateHouseNumber: bool(c.separateHouseNumber),
			customsDeclarations: bool(c.customsDeclarations),
			requiresEmail: bool(c.requiresEmail),
			requiresPhone: bool(c.requiresPhone),
			requiresSize: bool(c.requiresSize),
			disallowsCod: bool(c.disallowsCod),
			country: String(c.country ?? "").toLowerCase(),
			currency: String(c.currency ?? "").toUpperCase(),
			maxWeight: Number(c.maxWeight ?? 0) || 0,
			labelRouting: c.labelRouting ? String(c.labelRouting) : undefined,
			labelName: c.labelName ? String(c.labelName) : undefined,
		}))
		.filter((c) => c.id)
}

function bool(v: unknown, dflt = false): boolean {
	if (v === undefined || v === null || v === "") return dflt
	if (typeof v === "boolean") return v
	const s = String(v).toLowerCase()
	return s === "true" || s === "1" || s === "yes"
}
