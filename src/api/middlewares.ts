import { defineMiddlewares } from "@medusajs/framework/http"

export default defineMiddlewares({
	routes: [
		{
			// Signature is HMAC over the raw bytes; keep them.
			matcher: "/hooks/packeta",
			method: ["POST"],
			bodyParser: { preserveRawBody: true },
		},
	],
})
