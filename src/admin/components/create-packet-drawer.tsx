import { Button, Checkbox, Drawer, Heading, Input, Label, Switch, Text, Textarea, toast } from "@medusajs/ui"
import { useMemo, useState } from "react"
import { createPacketForOrder, type AdminPacket, type CreatePacketBody } from "../lib/api"
import { t } from "../lib/i18n"

export interface DrawerItem {
	id: string
	title: string
	/** Still unfulfilled quantity. */
	quantity: number
}

interface Props {
	orderId: string
	orderTotal?: number
	currency?: string
	/** `order.metadata.packeta_cod` — pre-fills the toggle. */
	codFlagged: boolean
	items: DrawerItem[]
	onCreated: (packet: AdminPacket | null) => void
	trigger: React.ReactNode
}

/**
 * Admin "Create Packeta packet" form: item selection (split into several
 * packets), COD toggle/amount, weight, note, earliest delivery date, adult
 * content, dimensions.
 */
export function CreatePacketDrawer({
	orderId,
	orderTotal,
	currency,
	codFlagged,
	items,
	onCreated,
	trigger,
}: Props) {
	const [open, setOpen] = useState(false)
	const [cod, setCod] = useState(codFlagged)
	const [codAmount, setCodAmount] = useState<string>(orderTotal != null ? String(orderTotal) : "")
	const [weight, setWeight] = useState("")
	const [note, setNote] = useState("")
	const [deliverOn, setDeliverOn] = useState("")
	const [adult, setAdult] = useState(false)
	const [size, setSize] = useState({ length: "", width: "", height: "" })
	const [qty, setQty] = useState<Record<string, number>>(() =>
		Object.fromEntries(items.map((i) => [i.id, i.quantity])),
	)
	const [busy, setBusy] = useState(false)

	const selectedItems = useMemo(
		() => items.filter((i) => (qty[i.id] ?? 0) > 0).map((i) => ({ id: i.id, quantity: qty[i.id] })),
		[items, qty],
	)
	const allSelected = selectedItems.length === items.length && items.every((i) => qty[i.id] === i.quantity)

	const submit = async () => {
		setBusy(true)
		try {
			const body: CreatePacketBody = { cod }
			if (cod && codAmount.trim()) body.cod_amount = Number(codAmount.replace(",", "."))
			if (weight.trim()) body.weight_kg = Number(weight.replace(",", "."))
			if (note.trim()) body.note = note.trim()
			if (deliverOn) body.deliver_on = deliverOn
			if (adult) body.adult_content = true
			if (size.length && size.width && size.height) {
				body.size = { length: Number(size.length), width: Number(size.width), height: Number(size.height) }
			}
			if (!allSelected) body.items = selectedItems
			const { packet } = await createPacketForOrder(orderId, body)
			toast.success(t("packeta"), {
				description: packet ? t("packet_created", { barcode: packet.barcode }) : t("fulfillment_created"),
			})
			setOpen(false)
			onCreated(packet)
		} catch (e) {
			toast.error(t("packeta"), { description: (e as Error).message })
		} finally {
			setBusy(false)
		}
	}

	return (
		<Drawer open={open} onOpenChange={setOpen}>
			<Drawer.Trigger asChild>{trigger}</Drawer.Trigger>
			<Drawer.Content>
				<Drawer.Header>
					<Heading>{t("create_packet_title")}</Heading>
				</Drawer.Header>
				<Drawer.Body className="flex flex-col gap-y-6 overflow-y-auto">
					<Text size="small" className="text-ui-fg-subtle">
						{t("create_packet_help")}
					</Text>

					{items.length > 1 ? (
						<div className="flex flex-col gap-y-2">
							<Label>{t("items")}</Label>
							<Text size="xsmall" className="text-ui-fg-muted">
								{t("items_help")}
							</Text>
							<div className="flex flex-col gap-y-1">
								{items.map((i) => (
									<label key={i.id} className="flex items-center gap-x-2 txt-small">
										<Checkbox
											checked={(qty[i.id] ?? 0) > 0}
											onCheckedChange={(c) => setQty((q) => ({ ...q, [i.id]: c ? i.quantity : 0 }))}
										/>
										<span className="flex-1 truncate">{i.title}</span>
										<Input
											size="small"
											type="number"
											min={0}
											max={i.quantity}
											className="w-16"
											value={qty[i.id] ?? 0}
											onChange={(e) =>
												setQty((q) => ({
													...q,
													[i.id]: Math.max(0, Math.min(i.quantity, Number(e.target.value) || 0)),
												}))
											}
										/>
										<span className="text-ui-fg-muted">/ {i.quantity}</span>
									</label>
								))}
							</div>
						</div>
					) : null}

					<div className="flex items-center justify-between gap-x-4">
						<div>
							<Label htmlFor="pkta-cod">{t("cod")}</Label>
							<Text size="xsmall" className="text-ui-fg-muted">
								{codFlagged ? t("cod_detected") : t("cod_not_detected")}
							</Text>
						</div>
						<Switch id="pkta-cod" checked={cod} onCheckedChange={setCod} />
					</div>
					{cod ? (
						<div className="flex flex-col gap-y-2">
							<Label htmlFor="pkta-cod-amount">
								{t("cod_amount")}
								{currency ? ` (${currency.toUpperCase()})` : ""}
							</Label>
							<Input
								id="pkta-cod-amount"
								inputMode="decimal"
								value={codAmount}
								onChange={(e) => setCodAmount(e.target.value)}
								placeholder={t("order_total")}
							/>
						</div>
					) : null}
					<div className="flex flex-col gap-y-2">
						<Label htmlFor="pkta-weight">{t("weight_kg")}</Label>
						<Input
							id="pkta-weight"
							inputMode="decimal"
							value={weight}
							onChange={(e) => setWeight(e.target.value)}
							placeholder={t("weight_auto")}
						/>
					</div>
					<div className="flex flex-col gap-y-2">
						<Label htmlFor="pkta-note">{t("note")}</Label>
						<Textarea
							id="pkta-note"
							value={note}
							onChange={(e) => setNote(e.target.value)}
							maxLength={128}
							placeholder={t("note_help")}
						/>
					</div>
					<div className="flex flex-col gap-y-2">
						<Label htmlFor="pkta-deliver-on">{t("deliver_on")}</Label>
						<Input
							id="pkta-deliver-on"
							type="date"
							value={deliverOn}
							onChange={(e) => setDeliverOn(e.target.value)}
						/>
					</div>
					<div className="flex items-center justify-between gap-x-4">
						<Label htmlFor="pkta-adult">{t("adult_content")}</Label>
						<Switch id="pkta-adult" checked={adult} onCheckedChange={setAdult} />
					</div>
					<div className="flex flex-col gap-y-2">
						<Label>{t("size_mm")}</Label>
						<div className="grid grid-cols-3 gap-2">
							{(["length", "width", "height"] as const).map((k) => (
								<Input
									key={k}
									inputMode="numeric"
									placeholder={t(k)}
									value={size[k]}
									onChange={(e) => setSize((s) => ({ ...s, [k]: e.target.value }))}
								/>
							))}
						</div>
						<Text size="xsmall" className="text-ui-fg-muted">
							{t("size_help")}
						</Text>
					</div>
				</Drawer.Body>
				<Drawer.Footer>
					<Drawer.Close asChild>
						<Button variant="secondary" size="small">
							{t("cancel")}
						</Button>
					</Drawer.Close>
					<Button size="small" isLoading={busy} disabled={!selectedItems.length} onClick={submit}>
						{t("create_packet")}
					</Button>
				</Drawer.Footer>
			</Drawer.Content>
		</Drawer>
	)
}
