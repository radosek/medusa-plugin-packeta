import type { MedusaContainer } from "@medusajs/framework/types"
import { ContainerRegistrationKeys, Modules } from "@medusajs/framework/utils"

export type Headers = { headers: Record<string, string> }

export async function createAdminUser(api: any, container: MedusaContainer): Promise<Headers> {
	const email = "admin@test.dev"
	const password = "supersecret"
	await api.post("/auth/user/emailpass/register", { email, password })
	const userModule = container.resolve(Modules.USER)
	const authModule = container.resolve(Modules.AUTH)
	const [existing] = await userModule.listUsers({ email })
	const user = existing ?? (await userModule.createUsers({ email }))
	const [identity] = await authModule.listAuthIdentities({ provider_identities: { entity_id: email } } as any)
	if (identity && !identity.app_metadata?.user_id) {
		await authModule.updateAuthIdentities({
			id: identity.id,
			app_metadata: { ...identity.app_metadata, user_id: user.id },
		})
	}
	const {
		data: { token },
	} = await api.post("/auth/user/emailpass", { email, password })
	return { headers: { Authorization: `Bearer ${token}` } }
}

export async function createPublishableKey(
	container: MedusaContainer,
): Promise<{ token: string; salesChannelId: string }> {
	const apiKeyModule = container.resolve(Modules.API_KEY)
	const salesChannelModule = container.resolve(Modules.SALES_CHANNEL)
	const link = container.resolve(ContainerRegistrationKeys.LINK)
	const [channel] = await salesChannelModule.createSalesChannels([{ name: "Test channel" }])
	const [key] = await apiKeyModule.createApiKeys([{ title: "test", type: "publishable", created_by: "test" }])
	await link.create({
		[Modules.API_KEY]: { publishable_key_id: key.id },
		[Modules.SALES_CHANNEL]: { sales_channel_id: channel.id },
	})
	return { token: key.token, salesChannelId: channel.id }
}

export interface Store {
	adminHeaders: Headers
	storeHeaders: Headers
	regionId: string
	salesChannelId: string
	locationId: string
	serviceZoneId: string
	shippingProfileId: string
	variantId: string
	pickupOptionId: string
	hdOptionId: string
}

/**
 * Minimal commerce setup: CZ/SK region (CZK), stock location + fulfillment
 * set/service zone with the Packeta provider, default shipping profile, a
 * product with a priced variant (no inventory management), and two Packeta
 * shipping options (pickup / home delivery).
 */
async function step<T>(name: string, fn: () => Promise<T>): Promise<T> {
	try {
		return await fn()
	} catch (e) {
		const err = e as { response?: { status?: number; data?: unknown }; message?: string }
		throw new Error(
			`seedStore step "${name}" failed: ${err.response ? `${err.response.status} ${JSON.stringify(err.response.data)}` : err.message}`,
		)
	}
}

export async function seedStore(api: any, container: MedusaContainer): Promise<Store> {
	const adminHeaders = await createAdminUser(api, container)
	const { token, salesChannelId } = await createPublishableKey(container)
	const storeHeaders: Headers = { headers: { "x-publishable-api-key": token } }

	const {
		data: { region },
	} = await api.post(
		"/admin/regions",
		{
			name: "CZ & SK",
			currency_code: "czk",
			countries: ["cz", "sk"],
			payment_providers: ["pp_system_default"],
		},
		adminHeaders,
	)

	const {
		data: { stock_location: location },
	} = await api.post(
		"/admin/stock-locations",
		{
			name: "Warehouse",
			address: { address_1: "Sklad 1", city: "Praha", country_code: "cz", postal_code: "10000" },
		},
		adminHeaders,
	)
	await api.post(
		`/admin/stock-locations/${location.id}/sales-channels`,
		{ add: [salesChannelId] },
		adminHeaders,
	)
	await api.post(
		`/admin/stock-locations/${location.id}/fulfillment-providers`,
		{ add: ["packeta_packeta"] },
		adminHeaders,
	)
	const withSet = await step(
		"fulfillment-set",
		async () =>
			(
				await api.post(
					`/admin/stock-locations/${location.id}/fulfillment-sets`,
					{ name: "Shipping", type: "shipping" },
					adminHeaders,
				)
			).data.stock_location,
	)
	const fulfillmentSetId: string =
		withSet.fulfillment_sets?.[0]?.id ??
		(await step(
			"fulfillment-set-refetch",
			async () =>
				(await api.get(`/admin/stock-locations/${location.id}?fields=fulfillment_sets.id`, adminHeaders)).data
					.stock_location.fulfillment_sets[0].id,
		))
	const fulfillment_set = await step(
		"service-zone",
		async () =>
			(
				await api.post(
					`/admin/fulfillment-sets/${fulfillmentSetId}/service-zones`,
					{
						name: "CZ & SK",
						geo_zones: [
							{ type: "country", country_code: "cz" },
							{ type: "country", country_code: "sk" },
						],
					},
					adminHeaders,
				)
			).data.fulfillment_set,
	)
	const serviceZoneId: string = fulfillment_set.service_zones[0].id

	const {
		data: { shipping_profiles },
	} = await api.get("/admin/shipping-profiles", adminHeaders)
	let shippingProfileId = shipping_profiles.find((p: { type: string }) => p.type === "default")?.id
	if (!shippingProfileId) {
		const {
			data: { shipping_profile },
		} = await api.post("/admin/shipping-profiles", { name: "Default", type: "default" }, adminHeaders)
		shippingProfileId = shipping_profile.id
	}

	const rules = [
		{ attribute: "enabled_in_store", value: "true", operator: "eq" },
		{ attribute: "is_return", value: "false", operator: "eq" },
	]
	const option = async (name: string, data: Record<string, unknown>, amount: number) => {
		const {
			data: { shipping_option },
		} = await api.post(
			"/admin/shipping-options",
			{
				name,
				service_zone_id: serviceZoneId,
				shipping_profile_id: shippingProfileId,
				provider_id: "packeta_packeta",
				price_type: "flat",
				type: { label: name, description: name, code: String(data.id) },
				data,
				prices: [{ currency_code: "czk", amount }],
				rules,
			},
			adminHeaders,
		)
		return shipping_option.id as string
	}
	const pickupOptionId = await option("Packeta pickup", { id: "packeta-pickup" }, 79)
	const hdOptionId = await option("Packeta home", { id: "packeta-home-delivery" }, 99)

	const {
		data: { product },
	} = await api.post(
		"/admin/products",
		{
			title: "Tee",
			handle: "tee",
			status: "published",
			shipping_profile_id: shippingProfileId,
			sales_channels: [{ id: salesChannelId }],
			options: [{ title: "Size", values: ["M"] }],
			variants: [
				{
					title: "M",
					sku: "TEE-M",
					manage_inventory: false,
					weight: 250,
					options: { Size: "M" },
					prices: [{ currency_code: "czk", amount: 500 }],
				},
			],
		},
		adminHeaders,
	)

	return {
		adminHeaders,
		storeHeaders,
		regionId: region.id,
		salesChannelId,
		locationId: location.id,
		serviceZoneId,
		shippingProfileId,
		variantId: product.variants[0].id,
		pickupOptionId,
		hdOptionId,
	}
}

/** Cart → shipping method → payment session (system default) → order. */
export async function placeOrder(
	api: any,
	store: Store,
	shipping: { option_id: string; data: Record<string, unknown> },
	address: Record<string, unknown> = {},
): Promise<{ id: string; display_id: number }> {
	const {
		data: { cart },
	} = await api.post(
		"/store/carts",
		{
			region_id: store.regionId,
			sales_channel_id: store.salesChannelId,
			email: "jan@example.com",
			items: [{ variant_id: store.variantId, quantity: 2 }],
			shipping_address: {
				first_name: "Jan",
				last_name: "Novák",
				address_1: "Na Pankráci 969/97",
				city: "Praha",
				postal_code: "140 00",
				country_code: "cz",
				phone: "+420777123456",
				...address,
			},
		},
		store.storeHeaders,
	)
	await api.post(`/store/carts/${cart.id}/shipping-methods`, shipping, store.storeHeaders)
	const {
		data: { payment_collection },
	} = await api.post("/store/payment-collections", { cart_id: cart.id }, store.storeHeaders)
	await api.post(
		`/store/payment-collections/${payment_collection.id}/payment-sessions`,
		{ provider_id: "pp_system_default" },
		store.storeHeaders,
	)
	const {
		data: { order },
	} = await api.post(`/store/carts/${cart.id}/complete`, {}, store.storeHeaders)
	return order
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
