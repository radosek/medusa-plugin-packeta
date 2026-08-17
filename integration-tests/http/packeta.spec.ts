import { medusaIntegrationTestRunner } from "@medusajs/test-utils"
import { signPacketaWebhook } from "../../src/api/lib/webhook"
import { placeOrder, seedStore, sleep, type Store } from "../helpers"
import { startMockPacketa, type MockPacketa } from "../mock-packeta"

jest.setTimeout(180_000)

const MOCK_PORT = 48991
const SIGNING_KEY = "test-signing-key"

// medusa-config.ts is evaluated when the runner boots the app, so the mock
// endpoints must be in the environment before that — not via the runner's `env`.
const ENV = {
	PACKETA_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/api/rest`,
	PACKETA_FEED_BASE_URL: `http://127.0.0.1:${MOCK_PORT}/v5`,
	PACKETA_WIDGET_VALIDATE_URL: `http://127.0.0.1:${MOCK_PORT}/validate`,
	PACKETA_WEBHOOK_SIGNING_KEY: SIGNING_KEY,
}
Object.assign(process.env, ENV)

medusaIntegrationTestRunner({
	inApp: true,
	env: ENV,
	testSuite: ({ api, getContainer }) => {
		let mock: MockPacketa
		let store: Store

		beforeAll(async () => {
			mock = await startMockPacketa(MOCK_PORT)
		})
		afterAll(async () => {
			await mock.close()
		})
		beforeEach(async () => {
			mock.reset()
			store = await seedStore(api, getContainer())
		})

		const webhook = (event: Record<string, unknown>, eventId: string) => {
			const body = JSON.stringify(event)
			const ts = String(Math.floor(Date.now() / 1000))
			return api.post("/hooks/packeta", body, {
				headers: {
					"Content-Type": "application/json",
					"X-Webhook-Timestamp": ts,
					"X-Webhook-Signature": signPacketaWebhook(SIGNING_KEY, ts, body),
					"X-Webhook-Event-Id": eventId,
				},
			})
		}

		it("registers the provider and exposes fulfillment options from the feed", async () => {
			const { data } = await api.get(
				"/admin/fulfillment-providers/packeta_packeta/options",
				store.adminHeaders,
			)
			const ids = data.fulfillment_options.map((o: { id: string }) => o.id)
			expect(ids).toEqual(
				expect.arrayContaining([
					"packeta-pickup",
					"packeta-home-delivery",
					"packeta-return",
					"packeta-carrier-106",
					"packeta-carrier-3060",
				]),
			)
			expect(data.fulfillment_options.find((o: { id: string }) => o.id === "packeta-return").is_return).toBe(
				true,
			)
		})

		it("reports health and serves the store carrier feed", async () => {
			const { data: health } = await api.get("/admin/packeta/health", store.adminHeaders)
			expect(health).toMatchObject({
				api: { ok: true },
				feed: { ok: true, carriers: 3 },
				webhook: { signing_key_configured: true },
			})

			const { data: carriers } = await api.get("/store/packeta/carriers?country=cz", store.storeHeaders)
			expect(carriers.home_delivery_carrier_id).toBe("106")
			expect(carriers.carriers.map((c: { id: string }) => c.id)).toEqual(["106"])
		})

		it("validates the pickup point at checkout", async () => {
			const {
				data: { cart },
			} = await api.post(
				"/store/carts",
				{
					region_id: store.regionId,
					sales_channel_id: store.salesChannelId,
					email: "a@b.cz",
					items: [{ variant_id: store.variantId, quantity: 1 }],
					shipping_address: {
						first_name: "A",
						last_name: "B",
						address_1: "X 1",
						city: "Praha",
						postal_code: "11000",
						country_code: "cz",
						phone: "+420777123456",
					},
				},
				store.storeHeaders,
			)
			const bad = await api
				.post(
					`/store/carts/${cart.id}/shipping-methods`,
					{ option_id: store.pickupOptionId, data: { point_id: "999999999" } },
					store.storeHeaders,
				)
				.catch((e: any) => e.response)
			expect(bad.status).toBe(400)
			expect(bad.data.message).toMatch(/not found/)

			const missing = await api
				.post(
					`/store/carts/${cart.id}/shipping-methods`,
					{ option_id: store.pickupOptionId, data: {} },
					store.storeHeaders,
				)
				.catch((e: any) => e.response)
			expect(missing.status).toBe(400)

			const ok = await api.post(
				`/store/carts/${cart.id}/shipping-methods`,
				{ option_id: store.pickupOptionId, data: { point_id: "79", point: { name: "My point" } } },
				store.storeHeaders,
			)
			expect(ok.status).toBe(200)
			const validates = mock.calls.filter((c) => c.url.startsWith("/validate"))
			expect(validates.map((c) => JSON.parse(c.body).point.id)).toEqual(["999999999", "79"])
		})

		it("runs the full pickup flow: order → COD flag → packet → labels → webhook ship/deliver", async () => {
			const order = await placeOrder(api, store, {
				option_id: store.pickupOptionId,
				data: { point_id: "79", point: { name: "Praha 4", country: "cz" } },
			})
			await sleep(1500) // order.placed subscriber

			const { data: fresh } = await api.get(
				`/admin/orders/${order.id}?fields=id,metadata,shipping_methods.data`,
				store.adminHeaders,
			)
			expect(fresh.order.metadata).toMatchObject({ packeta_cod: true })
			expect(fresh.order.shipping_methods[0].data).toMatchObject({
				kind: "pickup",
				point_id: "79",
				option_id: "packeta-pickup",
				point: { name: "Praha 4", street: "Hlavní 1" },
			})

			// Admin "create packet" route with an explicit COD amount and note.
			const created = await api.post(
				`/admin/packeta/orders/${order.id}/packet`,
				{ cod_amount: 1000, note: "Ring twice", weight_kg: 0.7 },
				store.adminHeaders,
			)
			expect(created.status).toBe(201)
			const packet = created.data.packet
			expect(packet).toMatchObject({
				kind: "pickup",
				cod: 1000,
				currency: "CZK",
				weight_kg: 0.7,
				status: { group: "created" },
				order: { id: order.id },
			})
			expect(packet.barcode).toMatch(/^Z\d+$/)

			const createXml = mock.calls.find((c) => c.body.includes("<createPacket>"))!.body
			expect(createXml).toContain("<addressId>79</addressId>")
			expect(createXml).toContain("<cod>1000</cod>")
			expect(createXml).toContain("<note>Ring twice</note>")
			expect(createXml).toContain("<eshop>test-sender</eshop>")
			expect(createXml).toContain("<email>jan@example.com</email>")

			// Fulfillment carries the tracking label.
			const { data: withF } = await api.get(
				`/admin/orders/${order.id}?fields=fulfillments.labels.tracking_number,fulfillments.data`,
				store.adminHeaders,
			)
			expect(withF.order.fulfillments[0].labels[0].tracking_number).toBe(packet.barcode)
			expect(withF.order.fulfillments[0].data.packet_id).toBe(packet.packet_id)

			// Labels: pdf, zpl, carrier, bulk.
			const pdf = await api.get(`/admin/packeta/packets/${packet.packet_id}/label`, {
				...store.adminHeaders,
				responseType: "arraybuffer",
			})
			expect(pdf.headers["content-type"]).toBe("application/pdf")
			expect(Buffer.from(pdf.data).toString("utf8")).toContain("%PDF")
			const zpl = await api.get(
				`/admin/packeta/packets/${packet.packet_id}/label?type=zpl&dpi=300`,
				store.adminHeaders,
			)
			expect(zpl.data).toBe("^XA^FDmock^FS^XZ")
			const carrier = await api.get(`/admin/packeta/packets/${packet.packet_id}/label?type=carrier`, {
				...store.adminHeaders,
				responseType: "arraybuffer",
			})
			expect(carrier.status).toBe(200)
			const bulk = await api.post(
				"/admin/packeta/packets/labels",
				{ packet_ids: [packet.packet_id] },
				{ ...store.adminHeaders, responseType: "arraybuffer" },
			)
			expect(bulk.headers["content-type"]).toBe("application/pdf")

			// List / detail routes.
			const list = await api.get(`/admin/packeta/packets?order_id=${order.id}`, store.adminHeaders)
			expect(list.data.count).toBe(1)
			const detail = await api.get(`/admin/packeta/packets/${packet.barcode}`, store.adminHeaders)
			expect(detail.data.packet.packet_id).toBe(packet.packet_id)

			// Webhook: arrived → shipped; duplicate ignored; delivered → delivered.
			const base = {
				id: Number(packet.packet_id),
				barcode: packet.barcode,
				dateTime: "2026-01-02T10:00:00",
				branchId: 1,
			}
			expect(
				(
					await webhook(
						{ status: { ...base, eventId: "e1", statusId: 2, statusCode: "arrived", statusText: "x" } },
						"e1",
					)
				).status,
			).toBe(200)
			await sleep(500)
			const shipped = await api.get(
				`/admin/orders/${order.id}?fields=fulfillment_status,fulfillments.shipped_at`,
				store.adminHeaders,
			)
			expect(shipped.data.order.fulfillment_status).toBe("shipped")

			expect(
				(
					await webhook(
						{ status: { ...base, eventId: "e1", statusId: 7, statusCode: "delivered", statusText: "x" } },
						"e1",
					)
				).status,
			).toBe(200)
			await sleep(300)
			const dup = await api.get(`/admin/packeta/packets/${packet.packet_id}`, store.adminHeaders)
			expect(dup.data.packet.status.id).toBe(2)

			expect(
				(
					await webhook(
						{ status: { ...base, eventId: "e2", statusId: 7, statusCode: "delivered", statusText: "x" } },
						"e2",
					)
				).status,
			).toBe(200)
			await sleep(500)
			const delivered = await api.get(
				`/admin/orders/${order.id}?fields=fulfillment_status`,
				store.adminHeaders,
			)
			expect(delivered.data.order.fulfillment_status).toBe("delivered")

			// Shipped packets can no longer be cancelled.
			const noCancel = await api
				.post(`/admin/packeta/packets/${packet.packet_id}/cancel`, {}, store.adminHeaders)
				.catch((e: any) => e.response)
			expect(noCancel.status).toBe(400)
		})

		it("creates a home-delivery packet from the native fulfillment flow and cancels it", async () => {
			const order = await placeOrder(
				api,
				store,
				{ option_id: store.hdOptionId, data: {} },
				{ address_1: "Vinohradská 1234/8", postal_code: "12000" },
			)
			const { data: o } = await api.get(
				`/admin/orders/${order.id}?fields=items.id,total,shipping_methods.data`,
				store.adminHeaders,
			)
			expect(o.order.shipping_methods[0].data).toMatchObject({ kind: "hd", carrier_id: "106" })

			const res = await api.post(
				`/admin/orders/${order.id}/fulfillments`,
				{ items: [{ id: o.order.items[0].id, quantity: 2 }] },
				store.adminHeaders,
			)
			expect(res.status).toBe(200)
			await sleep(1500) // fulfillment_created subscriber

			const createXml = mock.calls.find((c) => c.body.includes("<createPacket>"))!.body
			expect(createXml).toContain("<addressId>106</addressId>")
			expect(createXml).toContain("<street>Vinohradská</street>")
			expect(createXml).toContain("<houseNumber>1234/8</houseNumber>")
			expect(createXml).toContain("<zip>12000</zip>")
			expect(createXml).toContain(`<cod>${o.order.total}</cod>`) // COD flagged from pp_system_default → order total

			const list = await api.get(`/admin/packeta/packets?order_id=${order.id}`, store.adminHeaders)
			expect(list.data.count).toBe(1)
			const packet = list.data.packets[0]
			expect(packet).toMatchObject({
				kind: "hd",
				carrier_id: "106",
				address: { street: "Vinohradská", house_number: "1234/8" },
			})

			const cancelled = await api.post(
				`/admin/packeta/packets/${packet.packet_id}/cancel`,
				{},
				store.adminHeaders,
			)
			expect(cancelled.data.packet.cancelled_at).toBeTruthy()
			expect(mock.packets.get(packet.packet_id)?.cancelled).toBe(true)
			const { data: after } = await api.get(
				`/admin/orders/${order.id}?fields=fulfillment_status`,
				store.adminHeaders,
			)
			expect(after.order.fulfillment_status).toBe("canceled")
			// Idempotent.
			expect(
				(await api.post(`/admin/packeta/packets/${packet.packet_id}/cancel`, {}, store.adminHeaders)).status,
			).toBe(200)
		})

		it("rejects unsigned / tampered webhooks and ignores unknown packets", async () => {
			const unsigned = await api.post("/hooks/packeta", { status: { id: 1 } }).catch((e: any) => e.response)
			expect(unsigned.status).toBe(401)
			const body = JSON.stringify({
				status: {
					eventId: "x",
					id: 42,
					barcode: "Z42",
					dateTime: "2026-01-01T00:00:00",
					statusId: 2,
					statusCode: "arrived",
					statusText: "x",
				},
			})
			const ts = String(Math.floor(Date.now() / 1000))
			const tampered = await api
				.post("/hooks/packeta", body.replace("arrived", "delivered"), {
					headers: {
						"Content-Type": "application/json",
						"X-Webhook-Timestamp": ts,
						"X-Webhook-Signature": signPacketaWebhook(SIGNING_KEY, ts, body),
					},
				})
				.catch((e: any) => e.response)
			expect(tampered.status).toBe(401)
			const unknown = await webhook(
				{
					status: {
						eventId: "x",
						id: 42,
						barcode: "Z42",
						dateTime: "2026-01-01T00:00:00",
						statusId: 2,
						statusCode: "arrived",
						statusText: "x",
					},
				},
				"x",
			)
			expect(unknown.status).toBe(200)
		})

		it("surfaces Packeta faults from the create-packet route", async () => {
			const order = await placeOrder(api, store, {
				option_id: store.pickupOptionId,
				data: { point_id: "79" },
			})
			mock.failNextCreate = "Order nr. 1: Sender is not given."
			const res = await api
				.post(`/admin/packeta/orders/${order.id}/packet`, {}, store.adminHeaders)
				.catch((e: any) => e.response)
			expect(res.status).toBe(400)
			expect(res.data.message).toMatch(/Sender is not given/)
			const list = await api.get(`/admin/packeta/packets?order_id=${order.id}`, store.adminHeaders)
			expect(list.data.count).toBe(0)
		})
	},
})
