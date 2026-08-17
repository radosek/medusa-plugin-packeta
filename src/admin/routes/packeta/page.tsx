import { defineRouteConfig } from "@medusajs/admin-sdk"
import { ArrowPath, FlyingBox } from "@medusajs/icons"
import {
	Badge,
	Button,
	Checkbox,
	Container,
	Heading,
	Input,
	Select,
	StatusBadge,
	Table,
	Text,
	Tooltip,
	toast,
} from "@medusajs/ui"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "react-router-dom"
import {
	downloadLabels,
	health,
	listPackets,
	openLabel,
	refreshPacket,
	type AdminPacket,
	type HealthResponse,
} from "../../lib/api"
import {
	dateTime,
	destination,
	kindLabel,
	money,
	statusColor,
	statusGroupOf,
	statusLabel,
} from "../../lib/format"
import { groupLabel, t } from "../../lib/i18n"

const PAGE = 25
const GROUP_KEYS = [
	"created",
	"in_transit",
	"ready_for_pickup",
	"delivered",
	"problem",
	"returning",
	"returned",
	"cancelled",
] as const
const KIND_KEYS = ["pickup", "hd", "return"] as const

/** Sidebar page: every Packeta packet, filters, bulk labels, integration health. */
const PacketaPage = () => {
	const [rows, setRows] = useState<AdminPacket[]>([])
	const [count, setCount] = useState(0)
	const [page, setPage] = useState(0)
	const [q, setQ] = useState("")
	const [group, setGroup] = useState("")
	const [kind, setKind] = useState("")
	const [selected, setSelected] = useState<Set<string>>(new Set())
	const [loading, setLoading] = useState(false)
	const [busy, setBusy] = useState<string | null>(null)
	const [status, setStatus] = useState<HealthResponse | null>(null)

	const load = useCallback(async () => {
		setLoading(true)
		try {
			const res = await listPackets({ q, status_group: group, kind, limit: PAGE, offset: page * PAGE })
			setRows(res.packets)
			setCount(res.count)
		} catch (e) {
			toast.error(t("packeta"), { description: (e as Error).message })
		} finally {
			setLoading(false)
		}
	}, [q, group, kind, page])

	useEffect(() => {
		const t = setTimeout(() => void load(), q ? 250 : 0)
		return () => clearTimeout(t)
	}, [load, q])

	useEffect(() => {
		health()
			.then(setStatus)
			.catch(() => setStatus(null))
	}, [])

	const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.packet_id))
	const toggleAll = () => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.packet_id)))
	const toggle = (id: string) =>
		setSelected((s) => {
			const n = new Set(s)
			if (n.has(id)) n.delete(id)
			else n.add(id)
			return n
		})

	const pages = Math.max(1, Math.ceil(count / PAGE))
	const healthBadges = useMemo(() => {
		if (!status) return null
		return (
			<div className="flex flex-wrap items-center gap-2">
				<Tooltip content={status.api.ok ? t("health_api_ok") : (status.api.message ?? t("health_api_bad"))}>
					<StatusBadge color={status.api.ok ? "green" : "red"}>API</StatusBadge>
				</Tooltip>
				<Tooltip
					content={
						status.feed.ok
							? t("health_feed_ok", { n: status.feed.carriers ?? 0 })
							: (status.feed.message ?? t("health_feed_bad"))
					}
				>
					<StatusBadge color={status.feed.ok ? "green" : "red"}>Feed</StatusBadge>
				</Tooltip>
				<Tooltip
					content={
						status.webhook.signing_key_configured
							? t("health_webhook_ok", { path: status.webhook.path })
							: status.webhook.allow_unsigned
								? t("health_webhook_unsigned")
								: t("health_webhook_off")
					}
				>
					<StatusBadge
						color={
							status.webhook.signing_key_configured
								? "green"
								: status.webhook.allow_unsigned
									? "orange"
									: "grey"
						}
					>
						Webhook
					</StatusBadge>
				</Tooltip>
				<Badge size="2xsmall" color="grey">
					{t("sender")} {String(status.options.eshop)}
				</Badge>
			</div>
		)
	}, [status])

	const bulkLabels = async () => {
		setBusy("labels")
		try {
			await downloadLabels([...selected])
		} catch (e) {
			toast.error(t("packeta"), { description: (e as Error).message })
		} finally {
			setBusy(null)
		}
	}

	const refreshSelected = async () => {
		setBusy("refresh")
		try {
			for (const id of selected) {
				const { packet } = await refreshPacket(id)
				setRows((rs) => rs.map((r) => (r.packet_id === packet.packet_id ? packet : r)))
			}
			toast.success(t("packeta"), { description: t("refreshed_n", { n: selected.size }) })
		} catch (e) {
			toast.error(t("packeta"), { description: (e as Error).message })
		} finally {
			setBusy(null)
		}
	}

	return (
		<Container className="divide-y p-0">
			<div className="flex flex-col gap-y-3 px-6 py-4">
				<div className="flex items-center justify-between gap-x-4">
					<Heading level="h1">{t("packeta")}</Heading>
					{healthBadges}
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<Input
						size="small"
						placeholder={t("search")}
						value={q}
						onChange={(e) => {
							setPage(0)
							setQ(e.target.value)
						}}
						className="w-64"
					/>
					<Select
						size="small"
						value={group}
						onValueChange={(v) => {
							setPage(0)
							setGroup(v === "all" ? "" : v)
						}}
					>
						<Select.Trigger className="w-44">
							<Select.Value placeholder={t("all_statuses")} />
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="all">{t("all_statuses")}</Select.Item>
							{GROUP_KEYS.map((g) => (
								<Select.Item key={g} value={g}>
									{groupLabel(g)}
								</Select.Item>
							))}
						</Select.Content>
					</Select>
					<Select
						size="small"
						value={kind}
						onValueChange={(v) => {
							setPage(0)
							setKind(v === "all" ? "" : v)
						}}
					>
						<Select.Trigger className="w-40">
							<Select.Value placeholder={t("all_kinds")} />
						</Select.Trigger>
						<Select.Content>
							<Select.Item value="all">{t("all_kinds")}</Select.Item>
							{KIND_KEYS.map((k) => (
								<Select.Item key={k} value={k}>
									{kindLabel(k)}
								</Select.Item>
							))}
						</Select.Content>
					</Select>
					<div className="ml-auto flex items-center gap-2">
						<Button
							size="small"
							variant="secondary"
							disabled={!selected.size}
							isLoading={busy === "refresh"}
							onClick={refreshSelected}
						>
							<ArrowPath /> {t("refresh")} {selected.size ? `(${selected.size})` : ""}
						</Button>
						<Button
							size="small"
							variant="secondary"
							disabled={!selected.size}
							isLoading={busy === "labels"}
							onClick={bulkLabels}
						>
							{t("print_labels")} {selected.size ? `(${selected.size})` : ""}
						</Button>
					</div>
				</div>
			</div>

			<Table>
				<Table.Header>
					<Table.Row>
						<Table.HeaderCell className="w-8">
							<Checkbox checked={allSelected} onCheckedChange={toggleAll} aria-label={t("select_all")} />
						</Table.HeaderCell>
						<Table.HeaderCell>{t("barcode")}</Table.HeaderCell>
						<Table.HeaderCell>{t("order")}</Table.HeaderCell>
						<Table.HeaderCell>{t("kind")}</Table.HeaderCell>
						<Table.HeaderCell>{t("destination")}</Table.HeaderCell>
						<Table.HeaderCell>{t("status")}</Table.HeaderCell>
						<Table.HeaderCell className="text-right">{t("cod")}</Table.HeaderCell>
						<Table.HeaderCell>{t("created_at")}</Table.HeaderCell>
						<Table.HeaderCell />
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{rows.length === 0 ? (
						<Table.Row>
							<Table.Cell {...({ colSpan: 9 } as Record<string, unknown>)}>
								<Text size="small" className="text-ui-fg-muted">
									{loading ? t("loading") : t("no_packets")}
								</Text>
							</Table.Cell>
						</Table.Row>
					) : (
						rows.map((p) => {
							const dest = destination(p)
							return (
								<Table.Row key={p.packet_id}>
									<Table.Cell>
										<Checkbox
											checked={selected.has(p.packet_id)}
											onCheckedChange={() => toggle(p.packet_id)}
											aria-label={t("select_item", { barcode: p.barcode })}
										/>
									</Table.Cell>
									<Table.Cell>
										<span className="font-mono">{p.barcode}</span>
									</Table.Cell>
									<Table.Cell>
										{p.order ? (
											<Link to={`/orders/${p.order.id}`} className="text-ui-fg-interactive hover:underline">
												#{p.order.display_id ?? p.number ?? "?"}
											</Link>
										) : (
											(p.number ?? "—")
										)}
									</Table.Cell>
									<Table.Cell>{kindLabel(p.kind)}</Table.Cell>
									<Table.Cell>
										<div className="flex flex-col">
											<span className="truncate">{dest.title}</span>
											{dest.subtitle ? (
												<span className="text-ui-fg-muted txt-small truncate">{dest.subtitle}</span>
											) : null}
										</div>
									</Table.Cell>
									<Table.Cell>
										<Tooltip
											content={`${p.status.code ?? t("created").toLowerCase()} · ${dateTime(p.status.at ?? p.created_at)}`}
										>
											<StatusBadge color={statusColor(statusGroupOf(p))}>{statusLabel(p)}</StatusBadge>
										</Tooltip>
									</Table.Cell>
									<Table.Cell className="text-right">{p.cod > 0 ? money(p.cod, p.currency) : "—"}</Table.Cell>
									<Table.Cell>{dateTime(p.created_at)}</Table.Cell>
									<Table.Cell>
										<Button
											size="small"
											variant="transparent"
											onClick={() =>
												openLabel(p.packet_id).catch((e) =>
													toast.error(t("packeta"), { description: (e as Error).message }),
												)
											}
										>
											{t("label")}
										</Button>
									</Table.Cell>
								</Table.Row>
							)
						})
					)}
				</Table.Body>
			</Table>
			<Table.Pagination
				count={count}
				pageSize={PAGE}
				pageIndex={page}
				pageCount={pages}
				canPreviousPage={page > 0}
				canNextPage={page + 1 < pages}
				previousPage={() => setPage((p) => Math.max(0, p - 1))}
				nextPage={() => setPage((p) => Math.min(pages - 1, p + 1))}
			/>
		</Container>
	)
}

export const config = defineRouteConfig({
	label: "Packeta",
	icon: FlyingBox,
})

export default PacketaPage
