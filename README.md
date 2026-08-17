<p align="center">
  <img src="https://raw.githubusercontent.com/radosek/medusa-plugin-packeta/main/assets/packeta-icon.png" alt="Packeta" width="96" />
</p>

# medusa-plugin-packeta

[Packeta](https://www.packeta.com/) (Zásilkovna) fulfillment provider for **Medusa v2** — pickup points (Z-Point, Z-BOX, external carrier PUDOs), home delivery through Packeta's carrier network across Europe, cash on delivery, labels (PDF/ZPL, Packeta or carrier), push tracking, returns via the claim assistant, plus an admin UI and a storefront widget helper.

> **Disclaimer:** This is an unofficial, community-built integration. It is **not affiliated with, endorsed by, or maintained by Packeta s.r.o. / Zásilkovna s.r.o.** "Packeta", "Zásilkovna" and their logos are trademarks of their respective owners, used here only to identify the service this plugin integrates with.

[Packeta API docs](https://docs.packeta.com/) | [Medusa Fulfillment Module](https://docs.medusajs.com/resources/commerce-modules/fulfillment)

## Features

- **Fulfillment options**: `packeta-pickup` (any Packeta / partner pickup point chosen in the widget), `packeta-home-delivery` (Packeta home-delivery carrier picked from the shipping country), `packeta-return`, and — optionally — one option per carrier from Packeta's live carrier feed (`packeta-carrier-<id>`), so you can price Z-BOX, PPL ParcelShop, InPost, DHL … separately.
- **Checkout validation**: the selected pickup point is re-validated server-side against Packeta's widget validate endpoint (exists, allowed for your account, currently accepting packets).
- **Packets**: `createPacket` on fulfillment with COD, insured value, weight from variant weights, note, earliest delivery date, adult content, dimensions, carrier services, customs declarations for non-EU carriers.
- **COD** decided automatically from the order's payment provider (`pp_system_default` by default), overridable per packet in the admin.
- **Labels**: Packeta PDF (all formats), ZPL (203/300 dpi), external carrier PDF/ZPL, bulk PDF for many packets. Tracking number + label link attached to the Medusa fulfillment.
- **Tracking**: signed push-tracking webhook (`/hooks/packeta`) + a polling job fallback; statuses mark the Medusa fulfillment shipped / delivered automatically.
- **Cancel** packets (and the fulfillment) before hand-over; **returns** create claim-assistant packets with a drop-off password.
- **Admin UI** (EN/CS): order-page card with status, destination, COD, labels, refresh, cancel, "Create packet" (split orders into several packets); `/packeta` page listing all packets with filters, bulk label printing and integration health.
- **Storefront helper** `medusa-plugin-packeta/widget`: dependency-free wrapper around Packeta widget v6 + HD widget that returns exactly the `data` this provider expects.
- Zero runtime dependencies (fetch + `node:crypto`).

## Install

```bash
bun add medusa-plugin-packeta   # or npm / yarn / pnpm
```

## Configure

The same options object is passed to the fulfillment provider **and** to the plugin's `packeta` module (routes/workflows use the module, the checkout uses the provider). The plugin entry loads the API routes, subscribers, job and admin UI.

```ts
// medusa-config.ts
const packeta = {
  api_password: process.env.PACKETA_API_PASSWORD, // 32-hex API password
  api_key: process.env.PACKETA_API_KEY,           // 16-char API key (feeds, widget)
  eshop: process.env.PACKETA_ESHOP,               // sender indication (client section → Senders)
  webhook_signing_key: process.env.PACKETA_WEBHOOK_SIGNING_KEY, // from Packeta support, see Push tracking
  // optional — see the table below
  // cod_payment_providers: ["pp_system_default"],
  // enabled_carriers: ["106", "131", "3060"],
  // label_format: "A6 on A6",
}

module.exports = defineConfig({
  // ...
  modules: [
    {
      resolve: "@medusajs/medusa/fulfillment",
      options: {
        providers: [
          { resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
          { resolve: "medusa-plugin-packeta/providers/packeta", id: "packeta", options: packeta },
        ],
      },
    },
    { resolve: "medusa-plugin-packeta/modules/packeta", options: packeta },
  ],
  plugins: [{ resolve: "medusa-plugin-packeta", options: {} }],
})
```

Then run the plugin's migration (creates the `packeta_packet` table):

```bash
npx medusa db:migrate
```

The provider is registered as **`packeta_packeta`**. In the admin: *Settings → Locations & Shipping → your location → Fulfillment providers → add Packeta*, then create shipping options for the service zone choosing the Packeta fulfillment options (pickup / home delivery / per-carrier). Prices are flat Medusa prices — Packeta has no price API.

### Options

| Option | Required | Default | Description |
|---|---|---|---|
| `api_password` | yes | — | REST API password (client section → *Support*). |
| `api_key` | yes | — | API key used by the carrier feed, the widget and the widget validate endpoint. |
| `eshop` | yes | — | Sender indication. Use a dedicated test sender while integrating — Packeta has no sandbox. |
| `cod_payment_providers` | no | `["pp_system_default"]` | Payment provider ids that mean cash on delivery. |
| `default_weight_kg` | no | `0.5` | Packet weight when the order has no variant weights. |
| `packaging_weight_g` | no | `100` | Added to the summed variant weights (grams). |
| `label_format` | no | `"A6 on A6"` | `A6 on A6`, `A7 on A7`, `A6 on A4`, `A7 on A4`, `105x35mm on A4`, `A8 on A8`. |
| `expose_carriers` | no | `true` | Add one fulfillment option per carrier from the feed. |
| `enabled_carriers` | no | `"all"` | Carrier ids to expose (`["106", "3060"]`) or `"all"`. |
| `feed_ttl_s` | no | `86400` | Carrier feed cache TTL. |
| `validate_pickup_point` | no | `true` | Validate the chosen point through Packeta at checkout. |
| `webhook_signing_key` | no | — | Push-tracking signing key. Without it the webhook answers 503. |
| `allow_unsigned_webhook` | no | `false` | Accept unsigned webhooks (local development only). |
| `tracking_url` | no | `https://tracking.packeta.com/cs/?id={barcode}` | `{barcode}` / `{id}` placeholders. |
| `auto_ship_status_ids` | no | `[2,3,4,5,6,12]` | Packeta status ids that mark the fulfillment shipped. |
| `auto_deliver_status_ids` | no | `[7]` | Status ids that mark it delivered. |
| `default_size` | no | — | `{ length, width, height }` in mm, used when a carrier requires dimensions. |
| `customs` | no | — | `{ ead, default_hs_code, default_origin_country, invoice_number }` for non-EU carriers (see Customs). |
| `return_value_default` | no | `1` | Insured value for return claims when none is passed. |
| `poll_status` / `poll_status_cron` / `poll_status_batch` / `poll_status_max_age_days` | no | `true` / `*/30 * * * *` / `100` / `60` | Status polling job (fallback for push tracking). |
| `base_url`, `feed_base_url`, `widget_validate_url` | no | Packeta production URLs | Overridable for tests. |

### Environment

```
PACKETA_API_PASSWORD=
PACKETA_API_KEY=
PACKETA_ESHOP=
PACKETA_WEBHOOK_SIGNING_KEY=
```

## Storefront

Packeta pickup points are chosen in Packeta's widget on your storefront. Pass the selection as the shipping method `data`; the provider validates and normalises it.

```ts
import { pickPoint, pickAddress, pointToShippingMethodData, addressToShippingMethodData } from "medusa-plugin-packeta/widget"

// Pickup point (Z-Point, Z-BOX, partner PUDO). Filter with `vendors` / `country` if you like.
const point = await pickPoint(process.env.NEXT_PUBLIC_PACKETA_API_KEY!, { language: "cs", country: "cz,sk" })
if (point) {
  await sdk.store.cart.addShippingMethod(cart.id, {
    option_id: pickupShippingOption.id,
    data: pointToShippingMethodData(point),
  })
}

// Home delivery: the address from the cart is enough…
await sdk.store.cart.addShippingMethod(cart.id, { option_id: homeShippingOption.id, data: {} })

// …or let the customer pick a validated address in Packeta's HD widget (CZ/SK):
const carrierId = (await fetch(`${MEDUSA_URL}/store/packeta/carriers?country=cz`, { headers }).then((r) => r.json())).home_delivery_carrier_id
const address = await pickAddress(process.env.NEXT_PUBLIC_PACKETA_API_KEY!, { carrierId, language: "cs" })
if (address) {
  await sdk.store.cart.addShippingMethod(cart.id, { option_id: homeShippingOption.id, data: addressToShippingMethodData(address, carrierId) })
}
```

The `data` contract (what `pointToShippingMethodData` produces) if you drive the widget yourself:

```jsonc
// Packeta point
{ "point_id": "79", "point": { "id": "79", "name": "…", "street": "…", "city": "…", "zip": "…", "country": "cz", "group": "zbox", "type": "internal" } }
// Partner carrier point (InPost, PPL, …)
{ "carrier_id": "3060", "carrier_pickup_point_id": "BIA10M", "point": { "name": "…", "type": "external", "carrier_id": "3060", "carrier_pickup_point_id": "BIA10M" } }
// Home delivery with a specific address (optional; the cart address is the default)
{ "address": { "street": "Vinohradská", "house_number": "1", "city": "Praha", "zip": "12000", "country": "cz" } }
```

`GET /store/packeta/carriers?country=cz` returns the public carrier list (`id`, `name`, `country`, `pickup_points`, `disallows_cod`, `requires_size`, `max_weight`) and `home_delivery_carrier_id` — handy for widget `vendors` filters. See [`docs/storefront-nextjs.md`](docs/storefront-nextjs.md) for a Next.js starter walkthrough.

## Admin

- **Order page → Packeta card**: packet barcode, status, destination, COD/value/weight, tracking link, label menu (PDF, ZPL, carrier PDF/ZPL), refresh, cancel, return password. **Create packet** opens a drawer to choose items (split into several packets), COD, weight, note, earliest delivery date, adult content and dimensions.
- **Packeta page** (sidebar): all packets with search/filters, bulk *Print labels*, bulk *Refresh*, and health badges (API password, feed, webhook).
- Fulfilling an order the native way (*Fulfill items*) also creates the packet — the plugin mirrors it into `packeta_packet` and attaches the tracking label.
- The admin UI is in English and Czech (follows the browser language).

### Admin API

| Route | |
|---|---|
| `GET /admin/packeta/packets` | `?order_id= ?fulfillment_id= ?kind= ?status_group= ?q= ?limit= ?offset=` |
| `GET /admin/packeta/packets/:id` | `:id` = packet id, `Z…` barcode or record id |
| `GET /admin/packeta/packets/:id/label` | `?type=pdf|zpl|carrier|carrier-zpl&format=…&dpi=203|300&download=1` |
| `POST /admin/packeta/packets/labels` | `{ packet_ids, format?, offset? }` → one PDF |
| `POST /admin/packeta/packets/:id/refresh` | pull status from Packeta |
| `POST /admin/packeta/packets/:id/cancel` | cancel at Packeta + Medusa fulfillment |
| `POST /admin/packeta/orders/:id/packet` | `{ items?, cod?, cod_amount?, weight_kg?, note?, deliver_on?, adult_content?, size?, number? }` |
| `GET /admin/packeta/carriers` | carrier feed (`?country= ?refresh=1`) |
| `GET /admin/packeta/health` | credentials / feed / webhook status |

## How it works

1. **Checkout** — `validateFulfillmentData` receives the widget selection, checks it with Packeta's validate endpoint (pickup) or resolves the home-delivery carrier for the shipping country, and stores a normalised `{ kind, point_id | carrier_id + carrier_pickup_point_id, point | address }` on the shipping method.
2. **`order.placed`** — a subscriber looks at the payment provider; COD orders get `metadata.packeta_cod = true` (the fulfillment provider cannot see payments itself).
3. **Fulfillment** — `createFulfillment` maps order + shipping data to Packeta `createPacket` (recipient, destination, value, weight, COD, note, size, customs). The packet id/barcode land in `fulfillment.data`; a subscriber mirrors them into `packeta_packet` and attaches the tracking label to the fulfillment.
4. **Tracking** — Packeta pushes status events to `/hooks/packeta` (HMAC-SHA256 signed, deduplicated by event id). `arrived`/`departed`/… mark the fulfillment shipped, `delivered` marks it delivered. The polling job does the same for stores without push tracking.
5. **Cancel** — before hand-over, `cancelPacket` at Packeta and the fulfillment is cancelled in Medusa. Afterwards Packeta refuses (`CancelNotAllowedFault`) and so does the plugin.
6. **Returns** — a return shipping option using `packeta-return` creates a claim-assistant packet (`createPacketClaimWithPassword`); the customer drops it at any pickup point with the password shown in the admin (Packeta e-mails it too when the return has an e-mail).

## Push tracking (webhook)

Packeta enables webhooks per account: e-mail **integrations@packeta.com** with your HTTPS URL

```
https://<your-backend>/hooks/packeta
```

and they issue a **signing key** → `webhook_signing_key`. Requests are verified with `HMAC-SHA256(key, "{X-Webhook-Timestamp}.{rawBody}")` in constant time; unsigned or tampered requests get 401, unknown packets 200 (so Packeta stops retrying). Until the key is configured, the polling job keeps statuses fresh.

## Cash on delivery

COD is applied when the order's payment provider is in `cod_payment_providers` (default: Medusa's manual `pp_system_default`). The admin "Create packet" drawer shows the detected state and lets you override amount/off. Carriers with `disallowsCod` reject COD packets with a clear error.

## Customs (non-EU)

For carriers flagged `customsDeclarations` in the feed the plugin sends `attributes` (ead, deliveryCost, invoiceNumber, invoiceIssueDate) and `items` built from the order lines (variant/product `hs_code`, `origin_country`, title, value, units, weight). Configure `customs.ead` (`carrier` default), fallbacks (`default_hs_code`, `default_origin_country`) and pass per-packet extras (`invoiceFile`, `eadFile`, `mrn`, `customs_items`) via `additional_data.customs` when creating the fulfillment programmatically. See Packeta's [customs documentation](https://docs.packeta.com/docs/packet-creation/customs-declarations/overview).

## Storefront-agnostic notes

- Provider id: `packeta_packeta`; fulfillment option ids: `packeta-pickup`, `packeta-home-delivery`, `packeta-return`, `packeta-carrier-<id>`.
- Weight: Medusa variant `weight` is treated as **grams**.
- Amounts: Medusa v2 major units map 1:1 to Packeta `value`/`cod`. Currencies other than CZK/EUR/HUF/PLN/RON fall back to the destination country's currency.
- Phone numbers must be in Packeta's accepted formats (E.164 recommended).

## Development

```bash
bun install
bun run check              # format + lint + typecheck + unit tests
bun run build              # medusa plugin:build → .medusa/server
bun run test:integration   # boots a real Medusa app against a mocked Packeta API (needs Postgres: DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD)
```

Live smoke against your Packeta account (creates and cancels a real, free packet — use a test sender):

```bash
PACKETA_API_PASSWORD=… PACKETA_API_KEY=… PACKETA_ESHOP=… bun run smoke
bun run smoke carriers cz          # feed
bun run smoke validate 79          # widget validate endpoint
bun run smoke label <packetId>     # write label PDF
```

Try it inside a Medusa app without publishing: `scripts/dev-install.sh <path-to-medusa-app>` builds, packs and installs the tarball, then follow the config above.

## License

MIT — Radoš. Unofficial integration, not affiliated with Packeta s.r.o.
