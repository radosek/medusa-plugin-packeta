import type { PacketaOptions } from "../types"
import { PACKETA_DEFAULTS } from "../types"

export interface ValidatePointInput {
	/** Internal branch id. */
	id?: string
	/** External carrier id + its pickup point code. */
	carrierId?: string
	carrierPickupPointId?: string
}

export interface ValidateOptionsInput {
	country?: string
	carriers?: string
	weight?: number
	cashOnDelivery?: boolean
	vendors?: { carrierId?: string; country?: string; group?: string }[]
	claimAssistant?: boolean
	packetConsignment?: boolean
	livePickupPoint?: boolean
	expeditionDay?: string
	width?: number
	length?: number
	depth?: number
}

export interface ValidatePointResult {
	isValid: boolean
	point?: {
		name?: string
		address?: { street?: string; city?: string; zip?: string; country?: string }
		carrierId?: string
		group?: string
		country?: string
	}
	errors: { code: string; description: string }[]
}

/**
 * Server-side check of a widget-selected pickup point
 * (`POST https://widget.packeta.com/v6/pps/api/widget/v1/validate`). Selection
 * happens on the customer's device and can be forged; this confirms the point
 * exists, is allowed for the account and currently accepts packets.
 */
export async function validatePickupPoint(
	options: Pick<PacketaOptions, "api_key" | "widget_validate_url">,
	point: ValidatePointInput,
	validateOptions: ValidateOptionsInput = {},
	language = "en",
): Promise<ValidatePointResult> {
	const url = options.widget_validate_url ?? PACKETA_DEFAULTS.widget_validate_url
	const res = await fetch(url, {
		method: "POST",
		headers: { "Content-Type": "application/json", Accept: "application/json", "X-Language": language },
		body: JSON.stringify({ apiKey: options.api_key, point, options: validateOptions }),
	})
	if (res.status === 401) throw new Error("Packeta widget validate: invalid API key")
	const body = (await res.json().catch(() => ({}))) as Partial<ValidatePointResult> & { message?: string }
	if (!res.ok) {
		throw new Error(`Packeta widget validate: HTTP ${res.status}${body?.message ? ` — ${body.message}` : ""}`)
	}
	return {
		isValid: !!body.isValid,
		point: body.point,
		errors: Array.isArray(body.errors) ? body.errors : [],
	}
}
