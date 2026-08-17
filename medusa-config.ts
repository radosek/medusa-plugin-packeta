/**
 * Test-harness config: lets `@medusajs/test-utils` boot this repository as a
 * Medusa app (src/ doubles as the app tree) with the plugin's provider,
 * module, routes, subscribers and jobs loaded. Not part of the published
 * package — merchants configure the plugin in their own medusa-config.
 */
import { defineConfig, loadEnv } from "@medusajs/framework/utils"

loadEnv(process.env.NODE_ENV || "test", process.cwd())

const packeta = {
	api_password: process.env.PACKETA_API_PASSWORD || "0123456789abcdef0123456789abcdef",
	api_key: process.env.PACKETA_API_KEY || "abcdefghijklmnop",
	eshop: process.env.PACKETA_ESHOP || "test-sender",
	webhook_signing_key: process.env.PACKETA_WEBHOOK_SIGNING_KEY,
	base_url: process.env.PACKETA_BASE_URL,
	feed_base_url: process.env.PACKETA_FEED_BASE_URL,
	widget_validate_url: process.env.PACKETA_WIDGET_VALIDATE_URL,
	poll_status: false,
}

module.exports = defineConfig({
	projectConfig: {
		databaseUrl: process.env.DATABASE_URL,
		http: {
			storeCors: "http://localhost:8000",
			adminCors: "http://localhost:9000",
			authCors: "http://localhost:9000",
			jwtSecret: "supersecret",
			cookieSecret: "supersecret",
		},
	},
	admin: { disable: true },
	modules: [
		{
			resolve: "@medusajs/medusa/fulfillment",
			options: {
				providers: [
					{ resolve: "@medusajs/medusa/fulfillment-manual", id: "manual" },
					{ resolve: "./src/providers/packeta", id: "packeta", options: packeta },
				],
			},
		},
		{ resolve: "./src/modules/packeta", options: packeta },
	],
})
