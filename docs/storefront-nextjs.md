# Storefront: Medusa Next.js starter + Packeta

The plugin ships no React components on purpose — checkout UIs differ too much. This is
the smallest wiring for the [Medusa Next.js starter](https://github.com/medusajs/nextjs-starter-medusa)
using the dependency-free helper from `medusa-plugin-packeta/widget`.

## 1. Environment

```
NEXT_PUBLIC_PACKETA_API_KEY=abcdefghijklmnop   # 16-char API key (public; the widget needs it)
```

## 2. Shipping step

In `src/modules/checkout/components/shipping/index.tsx` the starter calls `setShippingMethod({ cartId, shippingMethodId })`.
Add a Packeta branch: when the chosen option is a Packeta pickup option, open the widget
first and pass the selection as `data`.

```tsx
"use client"
import { pickPoint, pointToShippingMethodData, formatPoint, type PacketaPoint } from "medusa-plugin-packeta/widget"
import { setShippingMethod } from "@lib/data/cart" // starter helper (calls sdk.store.cart.addShippingMethod)

// Which options are Packeta pickup? Ask the backend once and cache; the type code you set
// on the shipping option (`type.code`) is the simplest marker, e.g. "packeta-pickup".
const isPacketaPickup = (option: { type?: { code?: string } }) => option.type?.code === "packeta-pickup"

export function PacketaPickupButton({ cartId, option, onSelected }: { cartId: string; option: any; onSelected: (p: PacketaPoint) => void }) {
  const [point, setPoint] = useState<PacketaPoint | null>(null)
  const [error, setError] = useState<string | null>(null)

  const choose = async () => {
    const p = await pickPoint(process.env.NEXT_PUBLIC_PACKETA_API_KEY!, {
      language: "cs",
      country: "cz,sk",
      // vendors: [{ country: "cz", group: "zbox" }, { country: "cz", group: "" }, { carrierId: "3060" }],
    })
    if (!p) return
    try {
      await setShippingMethod({ cartId, shippingMethodId: option.id, data: pointToShippingMethodData(p) })
      setPoint(p)
      setError(null)
      onSelected(p)
    } catch (e) {
      // Backend rejected the point (full, closed, wrong carrier…): message comes from Packeta
      setError((e as Error).message)
    }
  }

  return (
    <div>
      <button type="button" onClick={choose}>{point ? "Change pickup point" : "Choose pickup point"}</button>
      {point ? <p>{formatPoint(point)}</p> : null}
      {error ? <p className="text-red-600">{error}</p> : null}
    </div>
  )
}
```

`setShippingMethod` in the starter does not forward `data` — extend it:

```ts
// src/lib/data/cart.ts
export async function setShippingMethod({ cartId, shippingMethodId, data }: { cartId: string; shippingMethodId: string; data?: Record<string, unknown> }) {
  const headers = { ...(await getAuthHeaders()) }
  return sdk.store.cart
    .addShippingMethod(cartId, { option_id: shippingMethodId, data }, {}, headers)
    .then(async () => { revalidateTag(await getCacheTag("carts")) })
    .catch(medusaError)
}
```

## 3. Home delivery

Nothing extra: `setShippingMethod({ cartId, shippingMethodId: homeOption.id })` — the
provider resolves the Packeta HD carrier from the shipping address country. To let the
customer confirm the address in Packeta's HD widget (CZ/SK only):

```ts
import { pickAddress, addressToShippingMethodData } from "medusa-plugin-packeta/widget"

const { home_delivery_carrier_id } = await fetch(`${process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL}/store/packeta/carriers?country=cz`, {
  headers: { "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY! },
}).then((r) => r.json())

const address = await pickAddress(process.env.NEXT_PUBLIC_PACKETA_API_KEY!, { carrierId: home_delivery_carrier_id, language: "cs" })
if (address) await setShippingMethod({ cartId, shippingMethodId: homeOption.id, data: addressToShippingMethodData(address, home_delivery_carrier_id) })
```

## 4. Showing the selection

The chosen point is on `cart.shipping_methods[0].data.point` (`name`, `street`, `city`,
`zip`) after the backend normalised it — render it in the review step and on the order
confirmation page.

## 5. Order confirmation / tracking

The Medusa fulfillment gets a label `{ tracking_number: "Z…", tracking_url }` once the
packet is created; the starter's order page already renders fulfillment labels.

## Notes

- Load nothing from Packeta on the server: the widget script is injected in the browser
  by `loadPacketaWidget()` on first use.
- The `country`/`vendors` options only filter the map; the backend re-validates.
- Per-carrier shipping options (`packeta-carrier-<id>`) restrict what the backend accepts
  — pass a matching `vendors: [{ carrierId }]` so the map matches.
