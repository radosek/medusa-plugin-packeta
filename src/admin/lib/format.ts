import type { AdminPacket } from "./api"
import { groupLabel, locale, t } from "./i18n"

export type BadgeColor = "green" | "red" | "blue" | "orange" | "grey" | "purple"

export function statusColor(group: string): BadgeColor {
	switch (group) {
		case "delivered":
			return "green"
		case "ready_for_pickup":
			return "blue"
		case "in_transit":
			return "purple"
		case "returning":
		case "problem":
			return "orange"
		case "cancelled":
		case "returned":
			return "red"
		default:
			return "grey"
	}
}

export function statusGroupOf(p: AdminPacket): string {
	return p.cancelled_at ? "cancelled" : p.status.group
}

/** Badge text: server label in English, group label otherwise. */
export function statusLabel(p: AdminPacket): string {
	if (p.cancelled_at) return t("cancelled")
	if (locale() === "en") return p.status.label
	return groupLabel(p.status.group)
}

export function kindLabel(kind: AdminPacket["kind"]): string {
	return kind === "hd" ? t("home_delivery") : kind === "return" ? t("return") : t("pickup_point")
}

export function destination(p: AdminPacket): { title: string; subtitle: string } {
	if (p.kind === "hd" && p.address) {
		const a = p.address
		return {
			title: [a.street, a.house_number].filter(Boolean).join(" ") || t("home_delivery"),
			subtitle: [a.zip, a.city, a.country?.toUpperCase()].filter(Boolean).join(" "),
		}
	}
	if (p.point) {
		const pt = p.point
		const id = pt.id
			? `#${pt.id}`
			: pt.carrier_pickup_point_id
				? `${pt.carrier_id ?? ""}/${pt.carrier_pickup_point_id}`
				: ""
		return {
			title: pt.name || (pt.group === "zbox" ? t("zbox") : t("pickup_point")),
			subtitle: [pt.street, pt.city, pt.zip, id].filter(Boolean).join(", "),
		}
	}
	if (p.kind === "return")
		return { title: t("return_packet"), subtitle: p.password ? `${t("password")} ${p.password}` : "" }
	return { title: p.carrier_id ? `Carrier ${p.carrier_id}` : "—", subtitle: "" }
}

export function money(amount: number, currency: string | null): string {
	if (!currency) return String(amount)
	try {
		return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount)
	} catch {
		return `${amount} ${currency}`
	}
}

export function dateTime(s: string | null | undefined): string {
	if (!s) return "—"
	const d = new Date(s)
	return Number.isNaN(d.getTime()) ? s : d.toLocaleString()
}
