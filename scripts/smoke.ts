/**
 * Live smoke test against the Packeta API (no Medusa backend needed).
 * Packeta has no sandbox: this creates REAL packets under your account. They
 * are free until physically consigned, and the script cancels what it creates.
 * Use a dedicated test sender (PACKETA_ESHOP).
 *
 *   PACKETA_API_PASSWORD=… PACKETA_API_KEY=… PACKETA_ESHOP=… bun run smoke [command] [args]
 *
 *   (no args)                 carriers → create test packet to point 79 → label PDF → status → cancel
 *   carriers [cc]             list carriers (optionally for a country)
 *   validate <pointId>        widget validate endpoint for an internal point
 *   validate <carrierId> <carrierPointId>   … for a carrier point
 *   create <pointId|carrierId> [carrierPointId]   create a packet and keep it (prints id)
 *   status <packetId>         packetStatus
 *   tracking <packetId>       packetTracking history
 *   label <packetId> [file]   write label PDF (default ./label-<id>.pdf)
 *   cancel <packetId>         cancelPacket
 *   claim <email>             createPacketClaimWithPassword (return packet)
 *   webhook-sign <key> <body> print X-Webhook-Timestamp/-Signature headers for a body
 */
import { writeFileSync } from "node:fs"
import { PacketaClient, PacketaError } from "../src/providers/packeta/lib/client"
import { PacketaFeed } from "../src/providers/packeta/lib/feed"
import { validatePickupPoint } from "../src/providers/packeta/lib/widget-validate"
import { signPacketaWebhook } from "../src/api/lib/webhook"

const api_password = process.env.PACKETA_API_PASSWORD
const api_key = process.env.PACKETA_API_KEY
const eshop = process.env.PACKETA_ESHOP
const [cmd, a1, a2] = process.argv.slice(2)

if (cmd === "webhook-sign") {
	const ts = String(Math.floor(Date.now() / 1000))
	console.log(`X-Webhook-Timestamp: ${ts}`)
	console.log(`X-Webhook-Signature: ${signPacketaWebhook(a1 ?? "", ts, a2 ?? "")}`)
	process.exit(0)
}

if (!api_password || !api_key || !eshop) {
	console.error("Set PACKETA_API_PASSWORD, PACKETA_API_KEY and PACKETA_ESHOP.")
	process.exit(1)
}
const client = new PacketaClient({ api_password })
const feed = new PacketaFeed({ api_key })

const testAttrs = (addressId: string, carrierPickupPoint?: string) => ({
	number: `SMOKE-${Date.now()}`,
	name: "Test",
	surname: "Medusa",
	email: "test@example.com",
	phone: "+420777123456",
	addressId,
	carrierPickupPoint,
	currency: "CZK",
	cod: 0,
	value: 100,
	weight: 0.5,
	eshop: eshop!,
	note: "medusa-plugin-packeta smoke",
})

async function main() {
	switch (cmd) {
		case "carriers": {
			const list = (await feed.carriers()).filter((c) => !a1 || c.country === a1.toLowerCase())
			for (const c of list)
				console.log(
					`${c.id.padStart(6)}  ${c.country}  ${c.pickupPoints ? "PP" : "HD"}  ${c.disallowsCod ? "noCOD" : "COD  "}  ${c.name}`,
				)
			console.log(`${list.length} carriers`)
			return
		}
		case "validate": {
			const point = a2 ? { carrierId: a1, carrierPickupPointId: a2 } : { id: a1 }
			console.log(JSON.stringify(await validatePickupPoint({ api_key: api_key! }, point), null, 2))
			return
		}
		case "create": {
			const r = await client.createPacket(testAttrs(a1, a2))
			console.log(`created packet ${r.id} (${r.barcode})`)
			return
		}
		case "status":
			console.log(await client.packetStatus(a1))
			return
		case "tracking":
			console.table(await client.packetTracking(a1))
			return
		case "label": {
			const pdf = await client.packetLabelPdf(a1, "A6 on A6")
			const file = a2 ?? `label-${a1}.pdf`
			writeFileSync(file, Buffer.from(pdf, "base64"))
			console.log(`wrote ${file}`)
			return
		}
		case "cancel":
			await client.cancelPacket(a1)
			console.log(`cancelled ${a1}`)
			return
		case "claim": {
			const r = await client.createPacketClaimWithPassword({
				number: `SMOKE-RET-${Date.now()}`,
				email: a1,
				value: 1,
				currency: "CZK",
				eshop: eshop!,
				consignCountry: "cz",
				sendEmailToCustomer: false,
			})
			console.log(r)
			return
		}
		case undefined: {
			console.log("→ carrier feed")
			const carriers = await feed.carriers()
			console.log(`  ${carriers.length} carriers; CZ HD = ${(await feed.homeDeliveryCarrier("cz"))?.id}`)

			console.log("→ createPacket (point 79)")
			const created = await client.createPacket(testAttrs("79"))
			console.log(`  id=${created.id} barcode=${created.barcode}`)

			console.log("→ packetLabelPdf")
			const pdf = await client.packetLabelPdf(created.id, "A6 on A6")
			writeFileSync(`label-${created.id}.pdf`, Buffer.from(pdf, "base64"))
			console.log(`  wrote label-${created.id}.pdf (${Buffer.from(pdf, "base64").length} bytes)`)

			console.log("→ packetStatus")
			const s = await client.packetStatus(created.id)
			console.log(`  ${s.statusCode} ${s.codeText} — ${s.statusText}`)

			console.log("→ cancelPacket")
			await client.cancelPacket(created.id)
			console.log("  cancelled")
			return
		}
		default:
			console.error(`unknown command ${cmd}`)
			process.exit(1)
	}
}

main().catch((e) => {
	if (e instanceof PacketaError) {
		console.error(`${e.fault}: ${e.message}`)
		if (e.attributes.length) console.table(e.attributes)
	} else {
		console.error(e)
	}
	process.exit(1)
})
