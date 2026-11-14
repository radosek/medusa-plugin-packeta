# Carrier filter — design

The `expose_carriers` option creates one fulfillment option per carrier in the
feed. The feed has more than one hundred carriers across Europe, so `"all"`
makes the shipping-option list hard to manage in the admin and
`enabled_carriers` only accepts a hand-written ID whitelist. This change adds
a declarative `carrier_filter` that narrows the carrier set everywhere the
plugin uses the feed.

## Goals

- A single filter applied to: the per-carrier fulfillment options
  (`packeta-carrier-<id>`), the home-delivery carrier auto-pick, and the store
  carriers endpoint.
- Storefront query overrides on `GET /store/packeta/carriers`, so the widget
  `vendors` config can narrow the list per checkout step.
- The admin carriers endpoint marks each carrier as enabled/filtered, so a
  future carriers admin page can show the effective set.
- Fully additive: existing configs behave exactly as today.

## Non-goals

- Carrier services (evening delivery, 18+), consignments (courier pickups),
  an admin carriers UI — separate changes.
- No per-country shipping rules or prices; prices stay Medusa's job.

## Config

```ts
carrier_filter?: {
  /** ISO alpha-2 list, case-insensitive. Empty/absent = all countries. */
  countries?: string[]
  /**
   * Delivery types. "hd" = carriers without pickup points,
   * "box" = pickup-point carriers whose name matches the box heuristic,
   * "pickup" = the remaining pickup-point carriers.
   */
  types?: ("hd" | "pickup" | "box")[]
  /** true = only carriers that accept COD (`disallowsCod` false). */
  cod?: boolean
  /** Only carriers whose `maxWeight` is at least this many kg. */
  min_max_weight_kg?: number
  /** true = only carriers without `customsDeclarations` (EU-only shops). */
  eu_only?: boolean
  /** Carrier ids to drop after the criteria above. */
  exclude_ids?: string[]
}
```

`enabled_carriers` keeps working unchanged: the filter runs first, then the
ID whitelist intersects with the result. Precedence, narrowest wins:

1. `carrier_filter` — declarative criteria.
2. `enabled_carriers` — explicit whitelist on top of the filtered set.

## Type detection

The feed has `pickupPoints` but no explicit delivery type. Packeta's naming
convention is `<CC> <name> HD|PP|Box`, but real names do not always follow it
("PL InPost Paczkomaty"). Detection:

```ts
function carrierType(c: PacketaCarrier): "hd" | "box" | "pickup" {
  if (!c.pickupPoints) return "hd"
  return /\bbox\b|paczkomat|automat|locker/i.test(c.name) ? "box" : "pickup"
}
```

A wrong guess only affects the `types` filter; the carrier stays reachable
through the other types.

## Code changes

- `types.ts`: `PacketaCarrierFilter` interface, `carrier_filter` on
  `PacketaOptions`, default `undefined` (no filter). It is already optional,
  so `ResolvedPacketaOptions` needs `carrier_filter` kept optional — it joins
  the `Pick<>`-style optional keys next to `customs`.
- `lib/feed.ts`: pure `applyCarrierFilter(carriers, filter)` export plus
  `carrierType`. `homeDeliveryCarrier(country, filter)` takes an optional
  second argument and filters before picking — so a `cod`/`eu_only` filter is
  respected by the auto-pick as well.
- `service.ts` `getFulfillmentOptions()`: `applyCarrierFilter` between the
  `available` check and the `enabled_carriers` whitelist.
- `service.ts` `validateFulfillmentData()`: pass `options_.carrier_filter` to
  `homeDeliveryCarrier`.
- `service.ts` `validatePacketaOptions()`: validate `types` values are in
  `{"hd","pickup","box"}` and `countries` is a string array when present.
- `api/store/packeta/carriers/route.ts`: apply the configured filter first,
  then query overrides `type` (comma list), `cod` (`1`/`true`), keeping the
  existing `country` param.
- `api/admin/packeta/carriers/route.ts`: keep returning the full feed; add
  `enabled: boolean` per carrier = passes `carrier_filter` (and
  `enabled_carriers` whitelist), so an admin UI can mark the effective set.
- README: option-table row for `carrier_filter`, store-endpoint query params.
- Tests: unit tests for `applyCarrierFilter`/`carrierType` in
  `lib/__tests__`-style spec next to the existing ones; service spec for the
  filtered option list; store-route spec for query overrides (mock fixture
  already has HD + pickup carriers).

## Approaches considered

- **A (chosen): additive `carrier_filter` next to `enabled_carriers`.**
  Backward compatible, declarative, easy to review.
- B: widen `enabled_carriers` to `"all" | string[] | object`. One config
  surface but an awkward union type and a deprecation path.
- C: storefront-side filtering only. Does not shrink the admin fulfillment
  option list, which is the main pain.
