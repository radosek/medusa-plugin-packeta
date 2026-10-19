<p align="center">
  <img src="https://raw.githubusercontent.com/radosek/medusa-plugin-packeta/main/assets/packeta-icon.png" alt="Packeta" width="96" />
</p>

# medusa-plugin-packeta

[![npm](https://img.shields.io/npm/v/medusa-plugin-packeta.svg)](https://www.npmjs.com/package/medusa-plugin-packeta) [![CI](https://github.com/radosek/medusa-plugin-packeta/actions/workflows/ci.yml/badge.svg)](https://github.com/radosek/medusa-plugin-packeta/actions/workflows/ci.yml) [![license](https://img.shields.io/npm/l/medusa-plugin-packeta.svg)](LICENSE)

This plugin is a [Packeta](https://www.packeta.com/) (Zásilkovna) fulfillment provider for **Medusa v2**. It supports these functions:

- Pickup points: Z-Point, Z-BOX and pickup points of external carriers.
- Home delivery through the Packeta carrier network in Europe.
- Cash on delivery (COD).
- Labels in PDF or ZPL, from Packeta or from the carrier.
- Push tracking.
- Returns through the Packeta claim assistant.
- An admin UI and a helper for the storefront widget.

> **Disclaimer:** This plugin is an unofficial integration from the community. It is **not affiliated with, endorsed by, or maintained by Packeta s.r.o. / Zásilkovna s.r.o.** "Packeta", "Zásilkovna" and their logos are trademarks of their owners. This document uses them only to identify the service that the plugin connects to.

[npm](https://www.npmjs.com/package/medusa-plugin-packeta) | [Packeta API docs](https://docs.packeta.com/) | [Medusa Fulfillment Module](https://docs.medusajs.com/resources/commerce-modules/fulfillment)

## Features

- **Fulfillment options.**
  - `packeta-pickup`: a Packeta or partner pickup point that the customer selects in the widget.
  - `packeta-home-delivery`: the Packeta home delivery carrier for the shipping country.
  - `packeta-return`.
  - Optional: one option for each carrier in the live Packeta carrier feed (`packeta-carrier-<id>`). Use these options to set different prices for Z-BOX, PPL ParcelShop, InPost, DHL and other carriers.
- **Checkout validation.** The server validates the selected pickup point again with the Packeta widget validate endpoint. The pickup point must exist, your account must have access to it, and it must accept packets now.
- **Packets.** The plugin calls `createPacket` when you create a fulfillment. The packet has COD, insured value, weight, note, earliest delivery date, adult content, dimensions, carrier services and customs declarations for non-EU carriers. The weight comes from the variant weights. The product weight is the fallback.
- **COD.** The plugin sets COD from the payment provider of the order (`pp_system_default` by default). You can change COD for each packet in the admin.
- **Labels.** Packeta PDF (all formats), ZPL (203 or 300 dpi), PDF or ZPL from an external carrier, and one bulk PDF for many packets. The plugin attaches the tracking number and the label link to the Medusa fulfillment.
- **Tracking.** A signed push tracking webhook (`/hooks/packeta`) and a polling job as a fallback. The statuses mark the Medusa fulfillment as shipped or delivered.
- **Cancel.** You can cancel a packet and its fulfillment before Packeta receives the packet.
- **Returns.** A return creates a claim assistant packet with a drop-off password.
- **Admin UI** (English and Czech).
  - A card on the order page shows status, destination, COD and labels. It has the actions Refresh, Cancel and "Create packet". "Create packet" can split an order into more than one packet.
  - The `/packeta` page shows all packets with filters, bulk label print and the integration health.
- **Storefront helper** `medusa-plugin-packeta/widget`. This helper wraps Packeta widget v6 and the home delivery widget. It has no dependencies. It returns the exact `data` that this provider expects.
- No runtime dependencies (only fetch and `node:crypto`).

## Install

```bash
bun add medusa-plugin-packeta   # or npm / yarn / pnpm
```

## Configure

Give the same options object to the fulfillment provider **and** to the `packeta` module of the plugin. The routes and workflows use the module. The checkout uses the provider. The plugin entry loads the API routes, the subscribers, the job and the admin UI.

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

Then run the migration of the plugin. It creates the `packeta_packet` table.

```bash
npx medusa db:migrate
```

The provider ID is **`packeta_packeta`**. Do these steps in the admin:

1. Go to *Settings → Locations & Shipping → your location → Fulfillment providers*.
2. Add Packeta.
3. Create shipping options for the service zone. Select the Packeta fulfillment options (pickup, home delivery or one carrier).

The prices are flat Medusa prices. Packeta has no price API.

### Options

| Option | Required | Default | Description |
|---|---|---|---|
| `api_password` | yes | — | REST API password. You find it in the client section → *Support*. |
| `api_key` | yes | — | API key for the carrier feed, the widget and the widget validate endpoint. |
| `eshop` | yes | — | Sender indication. Use a special test sender during the integration. Packeta has no sandbox. |
| `cod_payment_providers` | no | `["pp_system_default"]` | Payment provider IDs that mean cash on delivery. |
| `default_weight_kg` | no | `0.5` | Packet weight if no line has a variant weight or a product weight. |
| `packaging_weight_g` | no | `100` | The plugin adds this value (grams) to the sum of the line weights. |
| `label_format` | no | `"A6 on A6"` | `A6 on A6`, `A7 on A7`, `A6 on A4`, `A7 on A4`, `105x35mm on A4`, `A8 on A8`. |
| `expose_carriers` | no | `true` | Add one fulfillment option for each carrier in the feed. |
| `enabled_carriers` | no | `"all"` | Carrier IDs to show (`["106", "3060"]`) or `"all"`. |
| `feed_ttl_s` | no | `86400` | Time (seconds) that the plugin keeps the carrier feed in the cache. |
| `validate_pickup_point` | no | `true` | Validate the selected pickup point with Packeta at checkout. |
| `webhook_signing_key` | no | — | Signing key for push tracking. If this key is not set, the webhook sends 503. |
| `allow_unsigned_webhook` | no | `false` | Accept webhooks without a signature. Use it only for local development. The plugin ignores it in production. |
| `webhook_tolerance_s` | no | `300` | Maximum age (seconds) of a webhook timestamp. An older request is a replay. |
| `tracking_url` | no | `https://tracking.packeta.com/cs/?id={barcode}` | Use the `{barcode}` and `{id}` placeholders. |
| `auto_ship_status_ids` | no | `[2,3,4,5,6,12]` | Packeta status IDs that mark the fulfillment as shipped. |
| `auto_deliver_status_ids` | no | `[7]` | Packeta status IDs that mark the fulfillment as delivered. |
| `default_size` | no | — | `{ length, width, height }` in mm. The plugin uses it if a carrier requires dimensions. |
| `customs` | no | — | `{ ead, default_hs_code, default_origin_country, invoice_number }` for non-EU carriers. Refer to Customs. |
| `return_value_default` | no | `1` | Insured value for a return claim if the request has no value. |
| `poll_status` / `poll_status_cron` / `poll_status_batch` / `poll_status_max_age_days` | no | `true` / `*/30 * * * *` / `100` / `60` | Status polling job. It is the fallback for push tracking. |
| `base_url`, `feed_base_url`, `widget_validate_url` | no | Packeta production URLs | You can change these URLs for tests. |

### Environment

```
PACKETA_API_PASSWORD=
PACKETA_API_KEY=
PACKETA_ESHOP=
PACKETA_WEBHOOK_SIGNING_KEY=
```

## Storefront

The customer selects a Packeta pickup point in the Packeta widget on your storefront. Send the selection as the shipping method data (`data`). The provider validates and normalizes it.

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

If you control the widget yourself, send `data` in this format. `pointToShippingMethodData` gives the same format.

```jsonc
// Packeta point
{ "point_id": "79", "point": { "id": "79", "name": "…", "street": "…", "city": "…", "zip": "…", "country": "cz", "group": "zbox", "type": "internal" } }
// Partner carrier point (InPost, PPL, …)
{ "carrier_id": "3060", "carrier_pickup_point_id": "BIA10M", "point": { "name": "…", "type": "external", "carrier_id": "3060", "carrier_pickup_point_id": "BIA10M" } }
// Home delivery with a specific address (optional; the cart address is the default)
{ "address": { "street": "Vinohradská", "house_number": "1", "city": "Praha", "zip": "12000", "country": "cz" } }
```

`GET /store/packeta/carriers?country=cz` returns the public carrier list (`id`, `name`, `country`, `pickup_points`, `disallows_cod`, `requires_size`, `max_weight`) and `home_delivery_carrier_id`. Use it for the `vendors` filters of the widget. For a procedure with the Next.js starter, refer to [`docs/storefront-nextjs.md`](docs/storefront-nextjs.md).

## Admin

- **Order page → Packeta card.**
  - The card shows the packet barcode, status, destination, COD, value, weight and tracking link.
  - The label menu has PDF, ZPL, carrier PDF and carrier ZPL.
  - The card has the actions Refresh and Cancel, and it shows the return password.
  - **Create packet** opens a drawer. In the drawer, you select the items, COD, weight, note, earliest delivery date, adult content and dimensions. You can split the order into more than one packet.
- **Packeta page** (sidebar). The page shows all packets with search and filters. It has bulk *Print labels* and bulk *Refresh*. Health badges show the status of the API password, the feed and the webhook.
- The Medusa action *Fulfill items* also creates the packet. The plugin copies the packet into `packeta_packet` and attaches the tracking label.
- The admin UI is in English and Czech. It uses the browser language.

### Admin API

| Route | |
|---|---|
| `GET /admin/packeta/packets` | `?order_id= ?fulfillment_id= ?kind= ?status_group= ?q= ?limit= ?offset=` |
| `GET /admin/packeta/packets/:id` | `:id` is the packet ID, the `Z…` barcode or the record ID |
| `GET /admin/packeta/packets/:id/label` | `?type=pdf|zpl|carrier|carrier-zpl&format=…&dpi=203|300&download=1` |
| `POST /admin/packeta/packets/labels` | `{ packet_ids, format?, offset? }` → one PDF |
| `POST /admin/packeta/packets/:id/refresh` | Pull the status from Packeta |
| `POST /admin/packeta/packets/:id/cancel` | Cancel the packet at Packeta and the Medusa fulfillment |
| `POST /admin/packeta/orders/:id/packet` | `{ items?, cod?, cod_amount?, weight_kg?, note?, deliver_on?, adult_content?, size?, number? }` |
| `GET /admin/packeta/carriers` | Carrier feed (`?country= ?refresh=1`) |
| `GET /admin/packeta/health` | Status of the credentials, the feed and the webhook |

## How it works

1. **Checkout.** `validateFulfillmentData` receives the widget selection.
   - For a pickup point, it checks the selection with the Packeta validate endpoint.
   - For home delivery, it finds the home delivery carrier for the shipping country.
   - It stores a normalized `{ kind, point_id | carrier_id + carrier_pickup_point_id, point | address }` on the shipping method.
2. **`order.placed`.** A subscriber reads the payment provider. A COD order gets `metadata.packeta_cod = true`. The fulfillment provider cannot read payments itself.
3. **Fulfillment.** `createFulfillment` maps the order and the shipping method data to Packeta `createPacket` (recipient, destination, value, weight, COD, note, size, customs). The packet ID and barcode go into `fulfillment.data`. A subscriber copies them into `packeta_packet` and attaches the tracking label to the fulfillment.
4. **Tracking.** Packeta sends status events to `/hooks/packeta`. Each event has an HMAC-SHA256 signature. The plugin ignores a duplicate event ID. `arrived`, `departed` and similar statuses mark the fulfillment as shipped. `delivered` marks it as delivered. The polling job does the same for stores without push tracking.
5. **Cancel.** Before Packeta receives the packet, the plugin calls `cancelPacket` at Packeta and cancels the fulfillment in Medusa. After that time, Packeta refuses the cancel (`CancelNotAllowedFault`), and the plugin also refuses it.
6. **Returns.** A return shipping option with `packeta-return` creates a claim assistant packet (`createPacketClaimWithPassword`). The customer brings the packet to a pickup point and gives the password. The admin shows the password. If the return has an e-mail address, Packeta also sends the password by e-mail.

### Storefront contract (driving the widget yourself)

If you do not use `pointToShippingMethodData`, map the widget v6 `point` object as this table shows. If you use a different mapping, the packet can go to the wrong destination.

| Widget `point` | Shipping-method `data` | Notes |
|---|---|---|
| `pickupPointType === "internal"` (Z-Point, Z-BOX) | `point_id: String(point.id)` | Required. It becomes `addressId` in `createPacket`. |
| `pickupPointType === "external"` (partner PUDO) | `carrier_id: String(point.carrierId)`, `carrier_pickup_point_id: String(point.carrierPickupPointId)` | Both are required. **Do not** send `point.id` as `point_id` for these points. It is not a Packeta pickup point, and Packeta rejects or misroutes the packet. The plugin sends them as `addressId` and `carrierPickupPoint`. |
| `name`/`nameStreet`, `street`, `city`, `zip`, `country`, `group` | `point: { name, street, city, zip, country (lowercase), group, type }` | Only for display (admin card, order e-mails). If `validate_pickup_point` is on, the server validates it and fills it from Packeta. |
| — | `note` (optional) | Packet note. Maximum 128 characters. The plugin removes `"` and `;`. |

The cart must also have these values:

- A shipping address with `country_code`. It sets the region and, for home delivery, the carrier.
- The customer `email`.
- A `phone` on the shipping address. Packeta sends notifications to the recipient by e-mail and SMS.

For a pickup point, you can set the cart shipping address to the address of the pickup point. The packet destination always comes from `data`, not from the address.

Home delivery needs no values in `data`. The plugin uses `address_1`, `address_2` (house number), `city`, `postal_code` and `country_code` from the cart. It finds the carrier for the country in the live feed.

## Push tracking (webhook)

Packeta enables webhooks for each account. Send your HTTPS URL by e-mail to **integrations@packeta.com**:

```
https://<your-backend>/hooks/packeta
```

Packeta then gives you a **signing key**. Set it in `webhook_signing_key`.

The plugin verifies each request with `HMAC-SHA256(key, "{X-Webhook-Timestamp}.{rawBody}")` in constant time. The timestamp must be within `webhook_tolerance_s` (5 min) of the server clock.

| Condition | Response |
|---|---|
| No signing key is set | 503 |
| No signature, a wrong signature, or an old timestamp | 401 |
| The body is not a Packeta status event | 400 |
| Unknown packet | 200. Packeta stops the retries. |
| The plugin cannot store the status of a known packet | 500. Packeta sends the event again. |
| Medusa rejects the fulfillment update permanently (`INVALID_DATA`, `NOT_ALLOWED` or `NOT_FOUND`, for example for a cancelled order) | 200. The plugin logs an error. |
| The fulfillment update fails for a temporary cause | 500. The plugin runs the event again when Packeta sends it again. |

The plugin stores the status before it marks the fulfillment as shipped or delivered. Thus, a rejected fulfillment update does not remove the status. The poll job and the admin *Refresh* button use the same sequence (`syncPacketStatus` in `medusa-plugin-packeta/workflows`).

The plugin ignores a duplicate `X-Webhook-Event-Id`. A late or repeated event cannot move a delivered, returned or cancelled packet back to an earlier status.

Until you set the key, the polling job keeps the statuses up to date. By default, it runs every 30 minutes (`poll_status_cron`). `allow_unsigned_webhook` is only for local development. The plugin ignores it when `NODE_ENV=production`.

## Cash on delivery

The plugin applies COD if the payment provider of the order is in `cod_payment_providers`. The default is the Medusa manual provider `pp_system_default`. At `order.placed`, the plugin sets `order.metadata.packeta_cod` to `true`.

The admin "Create packet" drawer shows the COD state. You can change the amount or turn COD off. A carrier with `disallowsCod` rejects a COD packet with a clear error.

**Split shipments.** An order can have more than one packet, from the drawer or from partial fulfillments in Medusa. The customer pays the order **one time**:

1. The first packet has the full COD amount.
2. Then the flag changes to `"collected"`, and `packeta_cod_barcode` is set.
3. Each subsequent packet has COD 0. If you send `cod_amount`, the plugin uses that amount.

Each packet is insured for the value of its items. The first packet also includes the shipping cost. Subsequent packets get the reference `<order>-2`, `<order>-3` and so on.

## Customs (non-EU)

Some carriers have the `customsDeclarations` flag in the feed. For these carriers, the plugin sends:

- `attributes`: ead, deliveryCost, invoiceNumber, invoiceIssueDate.
- `items` from the order lines: `hs_code` and `origin_country` of the variant or product, title, value, units and weight.

Set `customs.ead` (default `carrier`) and the fallbacks `default_hs_code` and `default_origin_country`. If you create the fulfillment in code, send more values for each packet in `additional_data.customs`: `invoiceFile`, `eadFile`, `mrn` and `customs_items`. Refer to the Packeta [customs documentation](https://docs.packeta.com/docs/packet-creation/customs-declarations/overview).

## Storefront-agnostic notes

- Provider ID: `packeta_packeta`. Fulfillment option IDs: `packeta-pickup`, `packeta-home-delivery`, `packeta-return`, `packeta-carrier-<id>`.
- Weight: the plugin reads the Medusa variant or product `weight` as **grams**. The variant weight has priority. The product weight is the fallback. The admin **Create packet** procedure reads both. The Medusa *Create fulfillment* action reads only `variant.weight`. If you use that action, set the weights on the variants, or use the Packeta drawer.
- Amounts: Medusa v2 major units map 1:1 to Packeta `value` and `cod`. For currencies other than CZK, EUR, HUF, PLN and RON, the plugin uses the currency of the destination country.
- Phone numbers must be in a format that Packeta accepts. E.164 is recommended.

## Development

```bash
bun install
bun run check              # format + lint + typecheck + unit tests
bun run build              # medusa plugin:build → .medusa/server
bun run test:integration   # boots a real Medusa app against a mocked Packeta API (needs Postgres: DB_HOST/DB_PORT/DB_USERNAME/DB_PASSWORD)
```

Live smoke test with your Packeta account. It creates and cancels a real packet at no cost. Use a test sender.

```bash
PACKETA_API_PASSWORD=… PACKETA_API_KEY=… PACKETA_ESHOP=… bun run smoke
bun run smoke carriers cz          # feed
bun run smoke validate 79          # widget validate endpoint
bun run smoke label <packetId>     # write label PDF
```

To try the plugin in a Medusa app without a publish, run `scripts/dev-install.sh <path-to-medusa-app>`. The script builds, packs and installs the tarball. Then do the configuration above.

## License

MIT

This project is an independent, unofficial integration. It is not affiliated with or endorsed by Packeta s.r.o. / Zásilkovna s.r.o. All Packeta and Zásilkovna trademarks and logos are the property of their owners.
