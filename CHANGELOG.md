# Changelog

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
