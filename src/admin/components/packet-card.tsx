import { ArrowPath, ArrowUpRightOnBox, DocumentText, XMark } from "@medusajs/icons"
import {
	Badge,
	Button,
	Copy,
	DropdownMenu,
	IconButton,
	StatusBadge,
	Text,
	Tooltip,
	toast,
	usePrompt,
} from "@medusajs/ui"
import { useState } from "react"
import { cancelPacket, openLabel, refreshPacket, type AdminPacket, type LabelType } from "../lib/api"
import {
	dateTime,
	destination,
	kindLabel,
	money,
	statusColor,
	statusGroupOf,
	statusLabel,
} from "../lib/format"
import { t } from "../lib/i18n"

export function PacketStatusBadge({ packet }: { packet: AdminPacket }) {
	return <StatusBadge color={statusColor(statusGroupOf(packet))}>{statusLabel(packet)}</StatusBadge>
}

const LABEL_TYPES: {
	type: LabelType
	key: "label_pdf" | "label_zpl" | "label_carrier" | "label_carrier_zpl"
}[] = [
	{ type: "pdf", key: "label_pdf" },
	{ type: "zpl", key: "label_zpl" },
	{ type: "carrier", key: "label_carrier" },
	{ type: "carrier-zpl", key: "label_carrier_zpl" },
]

export function LabelMenu({
	packetId,
	busy,
	onBusy,
}: {
	packetId: string
	busy: boolean
	onBusy: (b: boolean) => void
}) {
	const open = async (type: LabelType) => {
		onBusy(true)
		try {
			await openLabel(packetId, { type, download: type !== "pdf" })
		} catch (e) {
			toast.error(t("packeta"), { description: (e as Error).message })
		} finally {
			onBusy(false)
		}
	}
	return (
		<DropdownMenu>
			<DropdownMenu.Trigger asChild>
				<Button size="small" variant="secondary" isLoading={busy}>
					<DocumentText /> {t("label")}
				</Button>
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="start">
				{LABEL_TYPES.map((l) => (
					<DropdownMenu.Item key={l.type} onClick={() => void open(l.type)}>
						{t(l.key)}
					</DropdownMenu.Item>
				))}
			</DropdownMenu.Content>
		</DropdownMenu>
	)
}

export function PacketCard({
	packet,
	onChange,
}: {
	packet: AdminPacket
	onChange?: (p: AdminPacket) => void
}) {
	const [busy, setBusy] = useState<"refresh" | "cancel" | "label" | null>(null)
	const prompt = usePrompt()
	const dest = destination(packet)
	const cancellable =
		!packet.cancelled_at && !packet.shipped_marked_at && (packet.status.id == null || packet.status.id === 1)

	const run = async (kind: "refresh" | "cancel", fn: () => Promise<AdminPacket | void>) => {
		setBusy(kind)
		try {
			const p = await fn()
			if (p) onChange?.(p)
		} catch (e) {
			toast.error(t("packeta"), { description: (e as Error).message })
		} finally {
			setBusy(null)
		}
	}

	return (
		<div className="flex flex-col gap-y-3 px-6 py-4">
			<div className="flex items-start justify-between gap-x-2">
				<div className="flex flex-col gap-y-1">
					<div className="flex items-center gap-x-2">
						<Text size="small" leading="compact" weight="plus" className="font-mono">
							{packet.barcode}
						</Text>
						<Copy content={packet.barcode} className="text-ui-fg-muted" />
						<Badge size="2xsmall" color={packet.kind === "return" ? "orange" : "grey"}>
							{kindLabel(packet.kind)}
						</Badge>
					</div>
					<Text size="small" leading="compact" className="text-ui-fg-subtle">
						{dest.title}
					</Text>
					{dest.subtitle ? (
						<Text size="xsmall" leading="compact" className="text-ui-fg-muted">
							{dest.subtitle}
						</Text>
					) : null}
				</div>
				<PacketStatusBadge packet={packet} />
			</div>

			<dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-ui-fg-subtle">
				<Row label={t("status")}>
					<Tooltip content={packet.status.text ?? ""}>
						<span>
							{packet.status.code ?? t("created").toLowerCase()} ·{" "}
							{dateTime(packet.status.at ?? packet.created_at)}
						</span>
					</Tooltip>
				</Row>
				<Row label={t("cod")}>{packet.cod > 0 ? money(packet.cod, packet.currency) : "—"}</Row>
				<Row label={t("value")}>{money(packet.value, packet.currency)}</Row>
				<Row label={t("weight")}>{packet.weight_kg != null ? `${packet.weight_kg} kg` : "—"}</Row>
				{packet.external_tracking_code ? (
					<Row label={t("carrier_tracking")}>{packet.external_tracking_code}</Row>
				) : null}
				{packet.stored_until ? <Row label={t("stored_until")}>{packet.stored_until}</Row> : null}
				{packet.kind === "return" && packet.password ? (
					<Row label={t("return_password")}>
						<span className="font-mono">{packet.password}</span>
					</Row>
				) : null}
			</dl>

			<div className="flex flex-wrap items-center gap-2">
				<LabelMenu
					packetId={packet.packet_id}
					busy={busy === "label"}
					onBusy={(b) => setBusy(b ? "label" : null)}
				/>
				<Button
					size="small"
					variant="secondary"
					isLoading={busy === "refresh"}
					onClick={() => run("refresh", async () => (await refreshPacket(packet.packet_id)).packet)}
				>
					<ArrowPath /> {t("refresh")}
				</Button>
				{packet.tracking_url ? (
					<Tooltip content={t("tracking")}>
						<IconButton size="small" variant="transparent" asChild>
							<a href={packet.tracking_url} target="_blank" rel="noreferrer">
								<ArrowUpRightOnBox />
							</a>
						</IconButton>
					</Tooltip>
				) : null}
				{cancellable ? (
					<Button
						size="small"
						variant="danger"
						isLoading={busy === "cancel"}
						onClick={() =>
							run("cancel", async () => {
								const ok = await prompt({
									title: t("cancel_packet_title"),
									description: t("cancel_packet_desc", {
										barcode: packet.barcode,
										fulfillment: packet.kind !== "return" ? t("cancel_packet_fulfillment") : "",
									}),
									confirmText: t("cancel_packet"),
									cancelText: t("keep"),
								})
								if (!ok) return
								const { packet: p } = await cancelPacket(packet.packet_id)
								toast.success(t("packeta"), { description: t("packet_cancelled", { barcode: p.barcode }) })
								return p
							})
						}
					>
						<XMark /> {t("cancel")}
					</Button>
				) : null}
			</div>
		</div>
	)
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
	return (
		<>
			<dt className="text-ui-fg-muted txt-small">{label}</dt>
			<dd className="txt-small truncate">{children}</dd>
		</>
	)
}
