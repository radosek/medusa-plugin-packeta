declare const __BACKEND_URL__: string | undefined

export const BACKEND_URL: string =
	typeof __BACKEND_URL__ !== "undefined" && __BACKEND_URL__ ? __BACKEND_URL__.replace(/\/$/, "") : ""

export interface AdminPacket {
	id: string
	packet_id: string
	barcode: string
	kind: "pickup" | "hd" | "return"
	number: string | null
	fulfillment_id: string | null
	order_id: string | null
	status: {
		id: number | null
		code: string | null
		text: string | null
		label: string
		group: string
		at: string | null
	}
	external_tracking_code: string | null
	external_status_text: string | null
	is_returning: boolean
	stored_until: string | null
	cod: number
	currency: string | null
	value: number
	weight_kg: number | null
	carrier_id: string | null
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
		type?: string
	} | null
	address: {
		street?: string
		house_number?: string
		city?: string
		zip?: string
		country?: string
		region?: string
	} | null
	tracking_url: string | null
	password: string | null
	shipped_marked_at: string | null
	delivered_marked_at: string | null
	cancelled_at: string | null
	created_at: string
	updated_at: string
	order: { id: string; display_id?: number | string | null; email?: string | null } | null
	label_url: string
}

export interface PacketListResponse {
	packets: AdminPacket[]
	count: number
	limit: number
	offset: number
}

export interface HealthResponse {
	api: { ok: boolean; message?: string }
	feed: { ok: boolean; carriers?: number; message?: string }
	webhook: { signing_key_configured: boolean; allow_unsigned: boolean; path: string }
	options: Record<string, unknown>
}

async function parseError(res: Response): Promise<string> {
	const ct = res.headers.get("content-type") ?? ""
	if (ct.includes("application/json")) {
		const body = (await res.json().catch(() => ({}))) as { message?: string; error?: string }
		return body.message || body.error || res.statusText
	}
	return (await res.text()) || res.statusText
}

export async function adminFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${BACKEND_URL}${path}`, {
		credentials: "include",
		...init,
		headers: {
			Accept: "application/json",
			...(init.body ? { "Content-Type": "application/json" } : {}),
			...init.headers,
		},
	})
	if (!res.ok) throw new Error(await parseError(res))
	return (await res.json()) as T
}

export function listPackets(
	params: Record<string, string | number | undefined>,
): Promise<PacketListResponse> {
	const qs = new URLSearchParams()
	for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") qs.set(k, String(v))
	return adminFetch<PacketListResponse>(`/admin/packeta/packets?${qs.toString()}`)
}

export function refreshPacket(packetId: string): Promise<{ packet: AdminPacket }> {
	return adminFetch(`/admin/packeta/packets/${encodeURIComponent(packetId)}/refresh`, { method: "POST" })
}

export function cancelPacket(packetId: string): Promise<{ packet: AdminPacket }> {
	return adminFetch(`/admin/packeta/packets/${encodeURIComponent(packetId)}/cancel`, { method: "POST" })
}

export interface CreatePacketBody {
	cod?: boolean
	cod_amount?: number
	weight_kg?: number
	note?: string
	deliver_on?: string
	adult_content?: boolean
	size?: { length: number; width: number; height: number }
	items?: { id: string; quantity: number }[]
}

export function createPacketForOrder(
	orderId: string,
	body: CreatePacketBody,
): Promise<{ packet: AdminPacket | null }> {
	return adminFetch(`/admin/packeta/orders/${encodeURIComponent(orderId)}/packet`, {
		method: "POST",
		body: JSON.stringify(body),
	})
}

export function health(): Promise<HealthResponse> {
	return adminFetch("/admin/packeta/health")
}

export type LabelType = "pdf" | "zpl" | "carrier" | "carrier-zpl"

export function labelHref(
	packetId: string,
	opts: { type?: LabelType; download?: boolean; format?: string; dpi?: number } = {},
): string {
	const qs = new URLSearchParams()
	if (opts.type && opts.type !== "pdf") qs.set("type", opts.type)
	if (opts.download) qs.set("download", "1")
	if (opts.format) qs.set("format", opts.format)
	if (opts.dpi) qs.set("dpi", String(opts.dpi))
	const q = qs.toString()
	return `${BACKEND_URL}/admin/packeta/packets/${encodeURIComponent(packetId)}/label${q ? `?${q}` : ""}`
}

/** Open a label PDF in a new tab (session cookie auth) or download it (ZPL always downloads). */
export async function openLabel(
	packetId: string,
	opts: { type?: LabelType; download?: boolean; format?: string; dpi?: number } = {},
): Promise<void> {
	const type = opts.type ?? "pdf"
	const download = opts.download ?? type.endsWith("zpl")
	const res = await fetch(labelHref(packetId, { ...opts, type, download }), { credentials: "include" })
	if (!res.ok) throw new Error(await parseError(res))
	const blob = await res.blob()
	const url = URL.createObjectURL(blob)
	if (download) {
		const a = document.createElement("a")
		a.href = url
		a.download = `packeta-${packetId}${type === "pdf" ? "" : `-${type}`}.${type.endsWith("zpl") ? "zpl" : "pdf"}`
		document.body.appendChild(a)
		a.click()
		a.remove()
	} else {
		window.open(url, "_blank", "noopener")
	}
	setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

export async function downloadLabels(packetIds: string[], format?: string): Promise<void> {
	const res = await fetch(`${BACKEND_URL}/admin/packeta/packets/labels`, {
		method: "POST",
		credentials: "include",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ packet_ids: packetIds, format }),
	})
	if (!res.ok) throw new Error(await parseError(res))
	const blob = await res.blob()
	const url = URL.createObjectURL(blob)
	const a = document.createElement("a")
	a.href = url
	a.download = `packeta-labels-${packetIds.length}.pdf`
	document.body.appendChild(a)
	a.click()
	a.remove()
	setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
