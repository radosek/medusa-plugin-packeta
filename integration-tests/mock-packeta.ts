import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http"

/**
 * In-process stand-in for the Packeta REST API, the carrier feed and the
 * widget validate endpoint. Records every request so tests can assert on the
 * XML the plugin sent. Configure the plugin with
 * `base_url = http://127.0.0.1:<port>/api/rest`,
 * `feed_base_url = http://127.0.0.1:<port>/v5`,
 * `widget_validate_url = http://127.0.0.1:<port>/validate`.
 */
export interface MockCall {
	url: string
	method: string
	body: string
}

export interface MockPacketa {
	port: number
	calls: MockCall[]
	packets: Map<string, { status: number; cancelled: boolean }>
	/** Override the next createPacket to fail with a PacketAttributesFault. */
	failNextCreate: string | null
	validPoint: boolean
	reset(): void
	close(): Promise<void>
}

const CARRIERS = [
	{
		id: "106",
		name: "CZ Zásilkovna domů HD",
		available: "true",
		pickupPoints: "false",
		apiAllowed: "true",
		requiresEmail: "true",
		requiresPhone: "true",
		requiresSize: "false",
		disallowsCod: "false",
		country: "cz",
		currency: "CZK",
		maxWeight: "30",
	},
	{
		id: "131",
		name: "SK Packeta Home HD",
		available: "true",
		pickupPoints: "false",
		country: "sk",
		currency: "EUR",
		maxWeight: "30",
	},
	{
		id: "3060",
		name: "PL InPost Paczkomaty",
		available: "true",
		pickupPoints: "true",
		requiresSize: "true",
		disallowsCod: "true",
		country: "pl",
		currency: "PLN",
		maxWeight: "25",
	},
]

const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]
const ok = (inner: string) => `<response><status>ok</status><result>${inner}</result></response>`
const fault = (name: string, msg: string, detail = "") =>
	`<response><status>fault</status><fault>${name}</fault><string>${msg}</string>${detail ? `<detail>${detail}</detail>` : ""}</response>`

let seq = 4000000000

export function startMockPacketa(port: number): Promise<MockPacketa> {
	const mock: MockPacketa = {
		port,
		calls: [],
		packets: new Map(),
		failNextCreate: null,
		validPoint: true,
		reset() {
			mock.calls = []
			mock.packets.clear()
			mock.failNextCreate = null
			mock.validPoint = true
		},
		close: () => Promise.resolve(),
	}

	const server: Server = createServer((req, res) => {
		let body = ""
		req.on("data", (c) => (body += c))
		req.on("end", () => {
			mock.calls.push({ url: req.url ?? "", method: req.method ?? "", body })
			route(mock, req, res, body)
		})
	})

	return new Promise((resolve) => {
		server.listen(port, "127.0.0.1", () => {
			mock.close = () => new Promise((r) => server.close(() => r()))
			resolve(mock)
		})
	})
}

function route(mock: MockPacketa, req: IncomingMessage, res: ServerResponse, body: string) {
	const url = req.url ?? ""
	if (url.includes("/carrier/json")) return json(res, CARRIERS)
	if (url.startsWith("/validate")) {
		const b = JSON.parse(body || "{}")
		if (!mock.validPoint || b.point?.id === "999999999") {
			return json(res, {
				isValid: false,
				errors: [{ code: "NotFound", description: "The pick-up point was not found." }],
			})
		}
		return json(res, {
			isValid: true,
			point: {
				name: "Mock point",
				address: { street: "Hlavní 1", city: "Praha", zip: "110 00", country: "cz" },
				group: "",
			},
			errors: [],
		})
	}
	if (url.startsWith("/api/rest")) return rest(mock, res, body)
	res.writeHead(404).end("not mocked")
}

function rest(mock: MockPacketa, res: ServerResponse, body: string) {
	const method = body.match(/<\?xml[^>]*\?>\s*<(\w+)>/)?.[1] ?? body.match(/^<(\w+)>/)?.[1] ?? ""
	if (tag(body, "apiPassword") !== "0123456789abcdef0123456789abcdef")
		return xml(res, fault("IncorrectApiPasswordFault", "Incorrect API password."))
	switch (method) {
		case "createPacket": {
			if (mock.failNextCreate) {
				const msg = mock.failNextCreate
				mock.failNextCreate = null
				return xml(
					res,
					fault(
						"PacketAttributesFault",
						"Failed to validate attributes. See detail.",
						`<attributes><fault><name>attr</name><fault>${msg}</fault></fault></attributes>`,
					),
				)
			}
			if (!tag(body, "email") && !tag(body, "phone")) {
				return xml(
					res,
					fault(
						"PacketAttributesFault",
						"Failed to validate attributes.",
						"<attributes><fault><name>email</name><fault>Please enter email.</fault></fault></attributes>",
					),
				)
			}
			const id = String(seq++)
			mock.packets.set(id, { status: 1, cancelled: false })
			return xml(res, ok(`<id>${id}</id><barcode>Z${id}</barcode><barcodeText>Z ${id}</barcodeText>`))
		}
		case "createPacketClaimWithPassword": {
			const id = String(seq++)
			mock.packets.set(id, { status: 1, cancelled: false })
			return xml(res, ok(`<id>${id}</id><barcode>Z${id}</barcode><password>123456</password>`))
		}
		case "cancelPacket": {
			const p = mock.packets.get(tag(body, "packetId") ?? "")
			if (!p) return xml(res, fault("PacketIdFault", "Invalid packet id."))
			if (p.status > 1)
				return xml(res, fault("CancelNotAllowedFault", "Packet state does not allow this operation."))
			p.cancelled = true
			p.status = 11
			return xml(res, ok(""))
		}
		case "packetStatus": {
			const p = mock.packets.get(tag(body, "packetId") ?? "")
			if (!p) return xml(res, fault("PacketIdFault", "Invalid packet id."))
			const code = p.status
			return xml(
				res,
				ok(
					`<dateTime>2026-01-01T10:00:00</dateTime><statusCode>${code}</statusCode><codeText>${code === 1 ? "received data" : code === 11 ? "cancelled" : "arrived"}</codeText><statusText>mock</statusText><branchId>0</branchId><isReturning>0</isReturning>`,
				),
			)
		}
		case "packetLabelPdf":
		case "packetsLabelsPdf":
		case "packetCourierLabelPdf":
			return xml(res, ok(Buffer.from("%PDF-1.4 mock").toString("base64")))
		case "packetLabelZpl":
			return xml(res, ok("^XA^FDmock^FS^XZ"))
		case "packetCourierNumberV2":
			return xml(res, ok("<courierNumber>CN123</courierNumber><carrierId>106</carrierId>"))
		default:
			return xml(res, fault("UnknownMethod", `mock: unknown method ${method}`))
	}
}

function xml(res: ServerResponse, body: string) {
	res.writeHead(200, { "Content-Type": "text/xml" }).end(`<?xml version="1.0"?>${body}`)
}

function json(res: ServerResponse, body: unknown) {
	res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify(body))
}
