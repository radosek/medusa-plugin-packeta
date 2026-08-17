# medusa-plugin-packeta — design

Packeta (Zásilkovna) fulfillment provider for Medusa v2. Sibling of
`medusa-plugin-comgate`: same tooling, layout conventions, README shape and
publishing contract, so both can sit in the Medusa integrations listing.

## Goals

- Full Packeta integration: pickup points (Packeta PUDO, Z-BOX, external carrier
  PUDOs), home delivery via Packeta carriers, COD, labels, tracking (push
  webhook + pull), cancel, returns (claim assistant).
- Admin UI: order-page card (packet, status, label, cancel, create) and a
  `/packeta` list page.
- Storefront: documented `data` contract for `addShippingMethod` plus a tiny
  dependency-free `medusa-plugin-packeta/widget` helper wrapping widget v6 /
  HD widget. No React shipped.
- Zero runtime deps (fetch + node:crypto + hand-rolled XML), like comgate.

## Non-goals

- Calculated prices (Packeta has no price API) — flat Medusa prices.
- Customs declarations / non-EU items, B2B packets, shipments (`createShipment`),
  ZPL/courier labels. `packetInfo`/courier numbers exposed read-only only.

## Packeta facts that shape the design

- REST: `POST https://www.zasilkovna.cz/api/rest`, XML body, root = method
  name, `apiPassword` first child. Response `<response><status>ok|fault</status>
  <result>…</result>|<fault>…</fault><string>…</string><detail>…</detail>`.
- Two secrets: `apiPassword` (32 hex, REST) and `apiKey` (16, feeds v5 +
  widget + widget validate endpoint).
- No sandbox; test sender (`eshop`) recommended. Packets are free until they
  physically enter the network; `cancelPacket` before consignment.
- Feeds v5: `https://pickup-point.api.packeta.com/v5/{apiKey}/carrier/json`,
  `branch/json`, `box/json`, `carrier_point/json?ids[]=`.
- Widget v6 (`https://widget.packeta.com/v6/www/js/library.js`):
  `Packeta.Widget.pick(apiKey, cb, options, inElement)`. Point has `id`
  (internal), `carrierId` + `carrierPickupPointId` (external),
  `pickupPointType`, `group` (`zbox`|""), name/street/city/zip/country.
  Server-side validation: `POST https://widget.packeta.com/v6/pps/api/widget/v1/validate`
  `{apiKey, point:{id | carrierId+carrierPickupPointId}, options}` →
  `{isValid, point:{name,address,carrierId,group}, errors[]}`.
- HD widget (`https://hd.widget.packeta.com/www/js/library.js`): options
  `{layout:"hd", carrierId, language, country, center*}` → `{address:{country,
  region,city,postcode,street,houseNumber}}`. CZ/SK only.
- createPacket: pickup → `addressId`=branch id; external PUDO → `addressId`=
  carrier id + `carrierPickupPoint`; HD → `addressId`=carrier id +
  street/houseNumber/city/zip. `value` (major units) + `weight` (kg) required,
  `cod` optional, `currency` CZK/EUR/HUF/PLN/RON, `number` = order ref, `eshop`.
- Labels: `packetLabelPdf(id, format, offset)` / `packetsLabelsPdf(ids, format,
  offset)` → base64 PDF in `<result>`. Formats: `A6 on A6`, `A7 on A7`,
  `A6 on A4`, `A7 on A4`, `105x35mm on A4`, `A8 on A8`.
- Tracking: `packetStatus(id)` → CurrentStatusRecord `{dateTime, statusCode,
  codeText, statusText, branchId, destinationBranchId, externalTrackingCode,
  isReturning, storedUntil, carrierId, carrierName}`; `packetTracking` history.
- Push tracking: enabled by emailing integrations@packeta.com with an HTTPS URL;
  Packeta issues a signing key. POST JSON one event per request, headers
  `X-Webhook-Timestamp`, `X-Webhook-Signature` = hex HMAC-SHA256(key,
  `${timestamp}.${rawBody}`), `X-Webhook-Event-Id` (dedupe, unsigned). Body
  `{status:{eventId,id,barcode,dateTime,branchId,statusId,statusCode,statusText,
  externalTrackingCode,destinationBranchId}}` or `{externalStatus:{…}}`.
  Expect 200/202; retries with backoff otherwise.
- Status ids: 1 received data, 2 arrived, 3 prepared for departure, 4 departed,
  5 ready for pickup, 6 handed to carrier, 7 delivered, 9 posted back,
  10 returned, 11 cancelled, 12 collected, 16/23/25 delivery attempts, 20
  storage expired, 999 unknown.
- Returns: `createPacketClaimWithPassword({number,email?,phone?,value,currency,
  eshop,consignCountry?,sendEmailToCustomer?})` → `{id,barcode,barcodeText,
  password}`; customer drops packet at a PUDO using the password.

## Package

- name `medusa-plugin-packeta`, MIT, author Radoš, repo
  `github.com/radosek/medusa-plugin-packeta`.
- keywords: `packeta zasilkovna zásilkovna czech slovak medusa medusa-plugin
  medusa-plugin-integration medusa-plugin-shipping medusa-plugin-fulfillment
  medusa-v2 fulfillment shipping pickup-point`.
- Tooling copied from comgate: bun, Medusa `2.19.0` dev pins, `@medusajs/framework: 2.x`
  peer, jest + ts-jest, oxlint/oxfmt (tabs), lefthook, GitHub CI, `bun run check`,
  `scripts/smoke.ts`, `.env.example`, `assets/packeta-logo.png` + icon, disclaimer.
- Build: `medusa plugin:build` → `.medusa/server`. `files: [".medusa/server"]`.
- exports:
  - `./package.json`
  - `./providers/*` → `./.medusa/server/src/providers/*/index.js`
  - `./modules/*` → `./.medusa/server/src/modules/*/index.js`
  - `./admin` → `.medusa/server/src/admin/index.{mjs,js}`
  - `./workflows` → `.medusa/server/src/workflows/index.js`
  - `./widget` → `.medusa/server/src/widget/index.js` (storefront helper; browser-safe, no Medusa imports)
  - `./*` → `./.medusa/server/src/*.js`

Note: comgate's exports point at `.medusa/server/providers/*` (its layout has no
`src` prefix because it predates plugin:build's current output). Verify actual
output path after first `plugin:build` and set exports accordingly; the
package-contract test guards it.

## Layout

```
src/
  index.ts                                # re-exports provider + types
  providers/packeta/
    index.ts                              # ModuleProvider(Modules.FULFILLMENT)
    service.ts                            # PacketaProviderService
    types.ts                              # options, fulfillment data shapes, packet DTOs
    lib/xml.ts                            # build/escape/parse minimal XML
    lib/client.ts                         # PacketaClient (REST) + PacketaError
    lib/feed.ts                           # carrier feed cache + lookups
    lib/widget-validate.ts                # widget validate endpoint client
    lib/packet.ts                         # pure mapping: Medusa order → PacketAttributes
    lib/status.ts                         # status id → label/badge/medusa action
    __tests__/*.spec.ts
  modules/packeta/
    index.ts                              # Module("packeta", { service })
    service.ts                            # MedusaService({ PacketaPacket })
    models/packeta-packet.ts
    migrations/Migration20260817000000.ts
  links/packet-fulfillment.ts             # readOnly link packet → fulfillment
  links/packet-order.ts                   # readOnly link packet → order
  workflows/
    index.ts
    record-packet.ts                      # upsert packet record from fulfillment
    sync-packet-status.ts                 # apply status (webhook or pull) + Medusa side effects
    cancel-packet.ts
    create-packet-for-order.ts            # admin "create packet" → createOrderFulfillmentWorkflow w/ additional_data
    flag-cod-order.ts                     # order.placed → metadata.packeta_cod
  subscribers/
    fulfillment-created.ts                # order.fulfillment_created → recordPacket
    order-placed.ts                       # order.placed → flagCodOrder
  api/
    middlewares.ts                        # raw body for /hooks/packeta
    hooks/packeta/route.ts                # push tracking webhook
    admin/packeta/packets/route.ts        # GET list
    admin/packeta/packets/[id]/route.ts   # GET one
    admin/packeta/packets/[id]/label/route.ts   # GET pdf
    admin/packeta/packets/[id]/refresh/route.ts # POST
    admin/packeta/packets/[id]/cancel/route.ts  # POST
    admin/packeta/packets/labels/route.ts # POST {ids, format} → merged pdf
    admin/packeta/orders/[id]/packet/route.ts   # POST create packet for order
    admin/packeta/carriers/route.ts       # GET feed
    admin/packeta/health/route.ts         # GET credentials/feed check
    store/packeta/carriers/route.ts       # GET public subset
  admin/
    index.ts
    lib/api.ts, lib/format.ts
    components/*.tsx
    widgets/order-packeta.tsx             # zone order.details.side.after
    routes/packeta/page.tsx               # sidebar "Packeta"
  widget/index.ts                         # storefront helper
scripts/smoke.ts
```

Provider container has no `query`; anything needing cross-module data lives in
workflows/subscribers/API routes (InPost pattern). The provider service is pure
"Medusa DTOs in → Packeta API out".

## Provider options (`PacketaOptions`)

| option | req | default | notes |
|---|---|---|---|
| `api_password` | yes | — | 32-hex REST password |
| `api_key` | yes | — | 16-char key: feeds, widget validate |
| `eshop` | yes | — | sender indication |
| `cod_payment_providers` | no | `["pp_system_default"]` | payment provider ids that mean COD |
| `default_weight_kg` | no | `0.5` | when no variant weights |
| `packaging_weight_g` | no | `100` | added to summed variant weights |
| `label_format` | no | `"A6 on A6"` | |
| `expose_carriers` | no | `true` | dynamic per-carrier fulfillment options from feed |
| `enabled_carriers` | no | `"all"` | `string[]` of carrier ids or `"all"` |
| `feed_ttl_s` | no | `86400` | |
| `validate_pickup_point` | no | `true` | call widget validate endpoint in `validateFulfillmentData` |
| `webhook_signing_key` | no | — | if unset, webhook rejects (503) unless `allow_unsigned_webhook` |
| `allow_unsigned_webhook` | no | `false` | dev only |
| `tracking_url` | no | `https://tracking.packeta.com/cs/?id={barcode}` | `{barcode}`/`{id}` placeholders |
| `auto_ship_status_ids` | no | `[2,3,4,5,6,12]` | statuses that mark fulfillment shipped |
| `auto_deliver_status_ids` | no | `[7]` | statuses that mark delivered |
| `return_value_default` | no | `1` | claim `value` when unknown |
| `base_url` | no | `https://www.zasilkovna.cz/api/rest` | |
| `feed_base_url` | no | `https://pickup-point.api.packeta.com/v5` | |
| `widget_validate_url` | no | `https://widget.packeta.com/v6/pps/api/widget/v1/validate` | |

Module options for `modules/packeta` are not needed; workflows resolve the
provider service via `fp_packeta_packeta` from the fulfillment module? No —
provider instances are inside the fulfillment module container and not
resolvable from the app container. Instead the **plugin options are declared
once** in `medusa-config.ts` under the fulfillment provider, and again for the
`packeta` module (`{ resolve: "medusa-plugin-packeta/modules/packeta", options }`)
sharing the same env vars. Document that both entries read the same envs; the
README config block does exactly this. Workflows/API routes construct a
`PacketaClient` from the packeta module service's options (`PacketaModuleService`
exposes `getClient()`, `getOptions()`).

## Provider behaviour

- `static identifier = "packeta"` → provider id `fp_packeta_packeta`.
- `validateOptions`: required options + api_password shape.
- `getFulfillmentOptions()`:
  - `packeta-pickup` — "Packeta pickup point (all)"
  - `packeta-home-delivery` — "Packeta home delivery"
  - `packeta-return` — `is_return: true`
  - if `expose_carriers`: for each feed carrier `available && (enabled_carriers==="all" || includes(id))`:
    `{ id: "packeta-carrier-{id}", name: "{name}", carrier_id, country,
    pickup_points, disallows_cod, requires_phone, requires_email, requires_size,
    max_weight, currency }`. Feed failure → static options only + logged warning.
- `validateOption(data)`: id is static or `packeta-carrier-\d+`.
- `canCalculate` → false.
- `validateFulfillmentData(optionData, data, ctx)`:
  - Determine kind: option `packeta-pickup` → pickup; `packeta-home-delivery` → hd;
    carrier option → `pickup_points ? pickup : hd`.
  - pickup: require `data.point_id` (internal) **or** `data.carrier_id +
    data.carrier_pickup_point_id` (external). Accept `data.point` snapshot
    `{ id?, name, street, city, zip, country, group?, carrier_id?,
    carrier_pickup_point_id?, type }`. If carrier option, external `carrier_id`
    must equal option carrier. If `validate_pickup_point`, call widget validate
    → `INVALID_DATA` with joined error descriptions when `!isValid`; merge
    returned name/address into snapshot when missing.
  - hd: `carrier_id` = option carrier or feed HD carrier for
    `ctx.shipping_address.country_code` (feed: `!pickupPoints && country ===
    cc`, prefer Packeta-own by name match `/Packeta|Zásilkovna/i`, else first);
    require shipping address street/city/zip. Optional `data.address` snapshot
    from HD widget `{street, house_number, city, zip, country}` overrides parsing.
  - Returns normalised `PacketaFulfillmentData`:
    `{ kind: "pickup"|"hd", option_id, point_id?, carrier_id?,
    carrier_pickup_point_id?, point?, address?, note? }`.
- `createFulfillment(data, items, order, fulfillment, additionalData)`:
  - `number` = `order.display_id` prefixed by `additionalData.number_prefix` ??
    "" (fallback `order.id`).
  - recipient from `order.shipping_address` (`first_name`,`last_name`,
    `company`,`phone`) + `order.email`; missing surname → split `first_name`.
  - `addressId`/`carrierPickupPoint`/HD address from data (`address` snapshot →
    fields; else `address_1` split into street + house number via
    `/^(.*?)[\s,]+(\d[\w\/-]*)$/`, `address_2` as house number when present).
  - `value` = `order.total` (major units; Medusa amounts are majors in v2),
    `currency` = upper `order.currency_code`, `weight` = Σ
    `items[].variant.weight (g) × quantity` + packaging → kg, else default.
    `additionalData.weight_kg` overrides.
  - `cod`: `additionalData.cod === false` → 0; `additionalData.cod_amount`
    number → that; else `order.metadata?.packeta_cod` truthy → `order.total`;
    else 0. Carrier `disallows_cod` + cod>0 → INVALID_DATA.
  - `note` from `additionalData.note` ?? `data.note`.
  - `eshop` from options; `additionalData.eshop` overrides.
  - Result `data`: `{ ...data, packet_id, barcode, barcode_text, number, cod,
    currency, value, weight_kg, created_at, tracking_url }`;
    `labels: [{ tracking_number: barcode, tracking_url, label_url:
    "/admin/packeta/packets/{packet_id}/label" }]`.
- `cancelFulfillment(data)` → `cancelPacket(packet_id)`; swallow
  `CancelNotAllowedFault`? No — surface it: Medusa must not think it's cancelled
  when Packeta already consigned it. Only ignore `PacketIdFault` when
  `data.cancelled_at` already set (idempotent replay).
- `createReturnFulfillment(fulfillment)`: fulfillment `data` (from return
  shipping method) + `delivery_address` + `metadata`. `number` = `RET-{order_id
  short}` or `data.number`; `email`/`phone` from `data`/`delivery_address`;
  `value` = `data.value` ?? option default; `currency` = `data.currency` ??
  address-country currency map ?? `CZK`; `consignCountry` = address country;
  `sendEmailToCustomer` = `!!email`. Result data `{ kind:"return", claim_id,
  barcode, barcode_text, password }`, labels `[{tracking_number: barcode,
  tracking_url, label_url: "/admin/packeta/packets/{claim_id}/label"}]`.
- `getFulfillmentDocuments/getShipmentDocuments/getReturnDocuments/retrieveDocuments`
  → `[{ type: "label", format: "pdf", base64 }]` from `packetLabelPdf`.

## Module `packeta`

Model `PacketaPacket` (table `packeta_packet`):
`id, packet_id (uniq text), barcode, kind (pickup|hd|return), fulfillment_id
(idx), order_id (idx), number, status_id (int|null), status_code, status_text,
status_at, external_tracking_code, is_returning, stored_until, cod (numeric),
currency, value, weight_kg, carrier_id, point (json), address (json),
tracking_url, last_event_id, shipped_marked_at, delivered_marked_at,
cancelled_at, raw (json)`. Read-only links to `fulfillment` and `order`.

`PacketaModuleService extends MedusaService({ PacketaPacket })` +
`getClient()`, `getOptions()`, `getFeed()`; module options = same
`PacketaOptions` shape (validated at loader).

## Workflows

- `recordPacketWorkflow({ fulfillment_id, order_id })`: query fulfillment
  (`data`, `provider_id`, `labels`), skip if not packeta; upsert record.
- `syncPacketStatusWorkflow({ packet_id, status?: PushStatus })`: if no status
  given → `packetStatus`. Update record. Side effects (idempotent, guarded by
  `shipped_marked_at`/`delivered_marked_at`, only for kind ≠ return):
  - status ∈ `auto_ship_status_ids` and fulfillment not shipped →
    `createOrderShipmentWorkflow({ order_id, fulfillment_id, labels: [] })`.
  - status ∈ `auto_deliver_status_ids` → `markOrderFulfillmentAsDeliveredWorkflow`.
  - 11 cancelled → set `cancelled_at`.
- `cancelPacketWorkflow({ packet_id })`: `cancelPacket` then
  `cancelOrderFulfillmentWorkflow` when the fulfillment isn't cancelled yet;
  set `cancelled_at`.
- `createPacketForOrderWorkflow({ order_id, cod?, cod_amount?, weight_kg?,
  note?, items? })`: picks the packeta shipping method's items (all unfulfilled
  by default), runs `createOrderFulfillmentWorkflow` with `additional_data`.
- `flagCodOrderWorkflow({ order_id })`: query payment collections' provider
  ids; if ∩ `cod_payment_providers` → `updateOrderWorkflow`/order module
  `updateOrders` metadata `{ packeta_cod: true }` (only when a packeta shipping
  method exists on the order).

## HTTP

- `POST /hooks/packeta`: raw body preserved via `middlewares.ts`
  (`bodyParser: { preserveRawBody: true }`). Verify signature (constant-time)
  with module option `webhook_signing_key`; 401 on mismatch, 503 when no key and
  not `allow_unsigned_webhook`. Parse `status` / `externalStatus`. Dedupe on
  `X-Webhook-Event-Id` vs `last_event_id`. Unknown packet → 200 (log) so Packeta
  stops retrying. Run `syncPacketStatusWorkflow`. Always 200 after auth.
- Admin routes as in layout; all use `req.scope.resolve("packeta")`. Label route
  streams `application/pdf` with `Content-Disposition: inline; filename=
  "packeta-{barcode}.pdf"`, `?format=` override. Bulk labels POST
  `{ packet_ids, format }`.
- Store `GET /store/packeta/carriers?country=cz` → `[{id,name,country,
  pickup_points,disallows_cod,requires_size,max_weight}]` (publishable-key
  protected by Medusa's default store middleware). Cache headers 1h.

## Admin UI

- Widget `order-packeta` (zone `order.details.side.after`): fetch
  `/admin/packeta/packets?order_id=`. Per packet: barcode (copy), status badge
  (color by group: created/transit/ready/delivered/returning/cancelled),
  destination (point name + address, or HD address + carrier), COD/value/
  weight, buttons: Label (open PDF), Refresh, Cancel (confirm), Tracking link,
  return password (kind=return). When order has an unfulfilled packeta shipping
  method: "Create packet" → prompt (COD toggle prefilled from metadata, amount,
  weight, note) → POST `/admin/packeta/orders/:id/packet`.
- Route `/packeta` (sidebar, icon Truck? use `@medusajs/icons` `Buildings`):
  DataTable of packets (barcode, order display id link, kind, destination,
  status, COD, created), filters (status group, kind, q), select → "Print
  labels" (bulk PDF), header shows health (`/admin/packeta/health`: creds ok,
  feed carriers count, webhook configured).
- Uses `@medusajs/ui`, `@medusajs/icons`, `@medusajs/admin-sdk`, `react-query`
  via `@medusajs/framework` admin sdk (`sdk.client.fetch`).

## Storefront helper `medusa-plugin-packeta/widget`

Browser ESM/CJS, no deps:
```ts
export const PACKETA_WIDGET_URL, PACKETA_HD_WIDGET_URL
export type PacketaPoint, PacketaWidgetOptions, PacketaVendor, PacketaHdAddress, PacketaHdOptions
export function loadPacketaWidget(url?): Promise<PacketaWidgetApi>       // injects <script> once
export function pickPoint(apiKey, options?, inElement?): Promise<PacketaPoint | null>
export function pickAddress(apiKey, options: PacketaHdOptions, inElement?): Promise<PacketaHdAddress | null>
export function pointToShippingMethodData(point): PacketaPickupData        // { point_id | carrier_id+carrier_pickup_point_id, point: {...} }
export function addressToShippingMethodData(addr): PacketaHdData
```
README documents the Next.js starter snippet:
`sdk.store.cart.addShippingMethod(cartId, { option_id, data: pointToShippingMethodData(point) })`.

## Config example (README)

```ts
const packeta = {
  api_password: process.env.PACKETA_API_PASSWORD,
  api_key: process.env.PACKETA_API_KEY,
  eshop: process.env.PACKETA_ESHOP,
  webhook_signing_key: process.env.PACKETA_WEBHOOK_SIGNING_KEY,
}
modules: [
  { resolve: "@medusajs/medusa/fulfillment", options: { providers: [
      { resolve: "medusa-plugin-packeta/providers/packeta", id: "packeta", options: packeta },
  ]}},
  { resolve: "medusa-plugin-packeta/modules/packeta", options: packeta },
],
plugins: [{ resolve: "medusa-plugin-packeta", options: {} }],
```
Plugin registration is what loads api routes/subscribers/workflows/admin.

## Testing

- Unit (jest, mocked `fetch`): xml build/escape/parse; client success/fault
  parsing + password redaction; feed parsing/caching/HD carrier resolution;
  `packet.ts` mapping (address split, weight, cod rules, currency); service
  `validateFulfillmentData` branches; webhook signature verify + dedupe;
  status → action mapping; package contract (identifier, exports, keywords,
  required provider methods).
- Smoke (`scripts/smoke.ts`, real account, test sender): `carrier feed` →
  `createPacket` to a given branch id → `packetLabelPdf` (write file) →
  `packetStatus` → `cancelPacket`. Also `validate <pointId>` and
  `webhook-sign <body>` helpers.
- CI: format, lint, typecheck, test, plugin:build.

## Open decisions taken

- Labels not stored in File module; served on demand from Packeta through the
  admin route (`label_url` relative). Simpler, no storage config required.
- COD is decided by payment provider id at `order.placed`, stored in
  `order.metadata.packeta_cod`; admin can override per packet.
- Storefront gets a helper, not components.
