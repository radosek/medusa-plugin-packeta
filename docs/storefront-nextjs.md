# Storefront: Medusa Next.js starter + Packeta

The plugin has no React components. This is intentional, because checkout UIs are very different.
This guide shows the minimum integration for the [Medusa Next.js starter](https://github.com/medusajs/nextjs-starter-medusa).
It uses the helper from `medusa-plugin-packeta/widget`, which has no dependencies.

## 1. Environment

```
NEXT_PUBLIC_PACKETA_API_KEY=abcdefghijklmnop   # 16-char API key (public; the widget needs it)
```

## 2. Shipping step

In `src/modules/checkout/components/shipping/index.tsx`, the starter calls `setShippingMethod({ cartId, shippingMethodId })`.
Add a Packeta branch:

1. If the selected option is a Packeta pickup option, open the widget first.
2. Send the selection as `data`.

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

`setShippingMethod` in the starter does not send `data`. Change it as follows:

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

Home delivery needs no extra code. Call `setShippingMethod({ cartId, shippingMethodId: homeOption.id })`.
The provider finds the Packeta home delivery carrier from the country of the shipping address.

The customer can also confirm the address in the Packeta home delivery widget (CZ and SK only):

```ts
import { pickAddress, addressToShippingMethodData } from "medusa-plugin-packeta/widget"

const { home_delivery_carrier_id } = await fetch(`${process.env.NEXT_PUBLIC_MEDUSA_BACKEND_URL}/store/packeta/carriers?country=cz`, {
  headers: { "x-publishable-api-key": process.env.NEXT_PUBLIC_MEDUSA_PUBLISHABLE_KEY! },
}).then((r) => r.json())

const address = await pickAddress(process.env.NEXT_PUBLIC_PACKETA_API_KEY!, { carrierId: home_delivery_carrier_id, language: "cs" })
if (address) await setShippingMethod({ cartId, shippingMethodId: homeOption.id, data: addressToShippingMethodData(address, home_delivery_carrier_id) })
```

## 4. Showing the selection

After the backend normalizes the selected pickup point, it is in `cart.shipping_methods[0].data.point`
(`name`, `street`, `city`, `zip`). Show it in the review step and on the order confirmation page.

## 5. Order confirmation / tracking

When the plugin creates the packet, the Medusa fulfillment gets a label `{ tracking_number: "Z…", tracking_url }`.
The order page of the starter already shows fulfillment labels.

## Notes

- Do not load Packeta code on the server. `loadPacketaWidget()` adds the widget script in the browser at the first use.
- The `country` and `vendors` options only filter the map. The backend validates the selection again.
- A shipping option for one carrier (`packeta-carrier-<id>`) limits the pickup points that the backend accepts.
  Send a matching `vendors: [{ carrierId }]`, so that the map shows the same pickup points.
