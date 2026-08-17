/** Packeta tracking status ids → human labels and coarse groups for the admin UI. */

export type PacketaStatusGroup =
	| "created"
	| "in_transit"
	| "ready_for_pickup"
	| "delivered"
	| "returning"
	| "returned"
	| "cancelled"
	| "problem"
	| "unknown"

export interface PacketaStatusMeta {
	id: number
	code: string
	label: string
	group: PacketaStatusGroup
}

const STATUSES: PacketaStatusMeta[] = [
	{ id: 1, code: "received data", label: "Data received", group: "created" },
	{ id: 2, code: "arrived", label: "Arrived at depot", group: "in_transit" },
	{ id: 3, code: "prepared for departure", label: "Prepared for departure", group: "in_transit" },
	{ id: 4, code: "departed", label: "Departed", group: "in_transit" },
	{ id: 5, code: "ready for pickup", label: "Ready for pickup", group: "ready_for_pickup" },
	{ id: 6, code: "handed to carrier", label: "Handed to carrier", group: "in_transit" },
	{ id: 7, code: "delivered", label: "Delivered", group: "delivered" },
	{ id: 9, code: "posted back", label: "Posted back", group: "returning" },
	{ id: 10, code: "returned", label: "Returned to sender", group: "returned" },
	{ id: 11, code: "cancelled", label: "Cancelled", group: "cancelled" },
	{ id: 12, code: "collected", label: "Collected", group: "in_transit" },
	{ id: 14, code: "customs", label: "Customs", group: "in_transit" },
	{ id: 15, code: "reverse packet arrived", label: "Return packet arrived", group: "in_transit" },
	{ id: 16, code: "delivery attempt", label: "Delivery attempt", group: "problem" },
	{ id: 17, code: "rejected by recipient", label: "Rejected by recipient", group: "returning" },
	{ id: 18, code: "rejected by recipient", label: "Rejected by recipient", group: "returning" },
	{
		id: 19,
		code: "return from hd no branch nearby",
		label: "Returning (no branch nearby)",
		group: "returning",
	},
	{ id: 20, code: "storage time expired", label: "Storage time expired", group: "returning" },
	{ id: 21, code: "packet cancelled but consigned", label: "Cancelled but consigned", group: "returning" },
	{ id: 22, code: "return overlimit", label: "Returning (over limit)", group: "returning" },
	{ id: 23, code: "zbox delivery attempt", label: "Z-BOX delivery attempt", group: "problem" },
	{ id: 24, code: "zbox last delivery attempt", label: "Z-BOX last delivery attempt", group: "problem" },
	{ id: 25, code: "carrier first delivery attempt", label: "Carrier delivery attempt", group: "problem" },
	{ id: 26, code: "packet under investigation", label: "Under investigation", group: "problem" },
	{ id: 27, code: "packet investigation resolved", label: "Investigation resolved", group: "in_transit" },
	{ id: 28, code: "favourite point redirect", label: "Redirected to favourite point", group: "in_transit" },
	{ id: 29, code: "no favourite point available redirect", label: "Redirected", group: "in_transit" },
	{ id: 30, code: "no favourite point set redirect", label: "Redirected", group: "in_transit" },
	{ id: 31, code: "courier tracking code added", label: "Courier tracking code added", group: "in_transit" },
	{ id: 999, code: "unknown", label: "Unknown", group: "unknown" },
]

const BY_ID = new Map(STATUSES.map((s) => [s.id, s]))

export function statusMeta(id: number | null | undefined): PacketaStatusMeta {
	return (
		(id != null && BY_ID.get(id)) || {
			id: id ?? 999,
			code: "unknown",
			label: `Status ${id ?? "?"}`,
			group: "unknown",
		}
	)
}

export function statusGroup(id: number | null | undefined): PacketaStatusGroup {
	return statusMeta(id).group
}

export const PACKETA_STATUSES = STATUSES
