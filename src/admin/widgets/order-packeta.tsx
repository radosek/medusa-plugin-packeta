import { defineWidgetConfig } from "@medusajs/admin-sdk"
import type { AdminOrder, DetailWidgetProps } from "@medusajs/framework/types"
import { Button, Container, Heading, Text } from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { CreatePacketDrawer, type DrawerItem } from "../components/create-packet-drawer"
import { PacketCard } from "../components/packet-card"
import { listPackets, type AdminPacket } from "../lib/api"
import { t } from "../lib/i18n"

/**
 * Order details → side column: Packeta packets for this order, with label /
 * refresh / cancel actions and a "Create packet" flow (supports splitting an
 * order into several packets) when the order uses a Packeta shipping method.
 */
const OrderPacketaWidget = ({ data: order }: DetailWidgetProps<AdminOrder>) => {
	const [packets, setPackets] = useState<AdminPacket[] | null>(null)
	const [error, setError] = useState<string | null>(null)

	// Shipping-method `data` is what our provider normalised at checkout, so a
	// Packeta method is recognisable without loading the shipping option.
	const isPacketa = useMemo(
		() =>
			(order.shipping_methods ?? []).some((m) =>
				String((m.data as { option_id?: string } | null)?.option_id ?? "").startsWith("packeta"),
			),
		[order.shipping_methods],
	)

	const load = useCallback(async () => {
		try {
			const res = await listPackets({ order_id: order.id, limit: 50 })
			setPackets(res.packets)
			setError(null)
		} catch (e) {
			setError((e as Error).message)
			setPackets([])
		}
	}, [order.id])

	useEffect(() => {
		void load()
	}, [load])

	if (!isPacketa && !(packets && packets.length)) return null

	const drawerItems: DrawerItem[] = (order.items ?? [])
		.map((i) => ({
			id: i.id,
			title: [i.product_title ?? i.title, i.variant_title].filter(Boolean).join(" · ") || i.id,
			quantity: Number(i.quantity) - Number(i.detail?.fulfilled_quantity ?? 0),
		}))
		.filter((i) => i.quantity > 0)
	const codFlagged = (order.metadata as Record<string, unknown> | null)?.packeta_cod === true

	const replace = (p: AdminPacket) =>
		setPackets((list) => (list ?? []).map((x) => (x.packet_id === p.packet_id ? p : x)))

	return (
		<Container className="divide-y p-0">
			<div className="flex items-center justify-between px-6 py-4">
				<Heading level="h2">{t("packeta")}</Heading>
				{isPacketa && drawerItems.length > 0 ? (
					<CreatePacketDrawer
						key={drawerItems.map((i) => `${i.id}:${i.quantity}`).join(",")}
						orderId={order.id}
						orderTotal={Number(order.total)}
						currency={order.currency_code}
						codFlagged={codFlagged}
						items={drawerItems}
						onCreated={() => void load()}
						trigger={
							<Button size="small" variant="secondary">
								{t("create_packet")}
							</Button>
						}
					/>
				) : null}
			</div>
			{error ? (
				<div className="px-6 py-4">
					<Text size="small" className="text-ui-fg-error">
						{error}
					</Text>
				</div>
			) : null}
			{packets === null ? (
				<div className="px-6 py-4">
					<Text size="small" className="text-ui-fg-muted">
						{t("loading")}
					</Text>
				</div>
			) : packets.length === 0 ? (
				<div className="px-6 py-4">
					<Text size="small" className="text-ui-fg-muted">
						{t("no_packet")} {codFlagged ? t("cod_flagged") : ""}
					</Text>
				</div>
			) : (
				packets.map((p) => <PacketCard key={p.packet_id} packet={p} onChange={replace} />)
			)}
		</Container>
	)
}

export const config = defineWidgetConfig({
	zone: "order.details.side.after",
})

export default OrderPacketaWidget
