# Changelog

## 0.1.2

- **Packet weight.** If a variant has no weight, the plugin uses the product weight. The "Create packet" workflow loads `items.variant.product.weight` and sends the calculated weight to the provider. Medusa's `createOrderFulfillmentWorkflow` loads only `variant.weight`.
- **Customs item weight.** If a variant has no weight, the plugin uses the product weight.
- **Unknown packets.** The webhook sends 200 for a packet that the store does not know. Workflow errors arrive as serialized objects, so the route uses `MedusaError.isMedusaError` and not `instanceof`.
- **Status and fulfillment update are separate.** The plugin stores the Packeta status first. Then it marks the fulfillment as shipped or delivered. If Medusa rejects that update, the stored status stays. Before, the rejected update also removed the status.
  - New: `applyPacketStatusWorkflow`, `applyPacketEffectsWorkflow` and the `syncPacketStatus` helper.
  - The webhook, the poll job and the admin "Refresh" route use `syncPacketStatus`.
  - `syncPacketStatusWorkflow` stays for existing callers. It keeps the old all-or-nothing behavior.
- **Webhook responses.**
  - The status cannot be stored: 500. Packeta sends the event again.
  - Medusa rejects the fulfillment update permanently (`INVALID_DATA`, `NOT_ALLOWED` or `NOT_FOUND`), for example for a cancelled order: the route logs an error and sends 200.
  - The fulfillment update fails for a temporary cause: 500. The route clears the event marker, so the next delivery of the event runs the update again.
- **Poll job.** The job also pulls a packet with a terminal status (7, 10 or 11) if its fulfillment update did not complete. Before, the job did not pull that packet again.
- **README.** A new table shows the shipping-method `data` that the storefront must send. It shows internal and external pickup points and the necessary cart fields.
- **Internal.** Server code imports modules through the `#src/*` package subpath import. Before, it used deep `../../../` paths. This change has no effect on the runtime or the API.
- **Tests.** The plugin is tested with Medusa 2.21.2. The dev dependencies changed from 2.19.0.

## 0.1.1

- `LICENSE` file shipped in the package; `author` set to the full name.
- Lint clean-up (no behaviour change).
- README: npm/CI badges.

## 0.1.0

Initial release. Tested against Medusa 2.19.0.

- Fulfillment provider `packeta_packeta`: pickup points (Packeta + partner PUDOs), home
  delivery, returns (claim assistant), optional per-carrier options from the live feed.
- Server-side pickup-point validation at checkout (widget validate endpoint), HD carrier
  auto-selection per country.
- Packets with COD (from payment provider), value, weight, note, delivery date, adult
  content, dimensions, carrier services, customs declarations for non-EU carriers.
- Labels: Packeta PDF (all formats), ZPL, carrier PDF/ZPL, bulk PDF; tracking labels on
  the Medusa fulfillment.
- Push-tracking webhook `/hooks/packeta` (HMAC-SHA256, replay window, deduped, terminal
  statuses never regress) + polling job; auto mark shipped/delivered.
- Split shipments: COD collected once (first packet), per-packet insured value and
  `<order>-n` references.
- Cancel + idempotent replay; `packeta_packet` module with read-only links to
  fulfillment/order.
- Admin: order card, `/packeta` page (filters, bulk labels, health), EN/CS.
- Storefront helper `medusa-plugin-packeta/widget` (widget v6 + HD widget wrappers).
- Unit tests (mocked fetch) and integration tests booting a real Medusa app against a
  mocked Packeta API.
