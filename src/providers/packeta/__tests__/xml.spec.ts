import {
	buildRequest,
	escapeXml,
	formatNumber,
	readBlock,
	readBlocks,
	readFlat,
	readTag,
	unescapeXml,
} from "../lib/xml"

describe("xml", () => {
	it("escapes and unescapes the five XML entities", () => {
		const s = `Tom & Jerry <"'>`
		expect(escapeXml(s)).toBe("Tom &amp; Jerry &lt;&quot;&apos;&gt;")
		expect(unescapeXml(escapeXml(s))).toBe(s)
		expect(unescapeXml("&#268;esk&#xE1;")).toBe("Česká")
	})

	it("builds a request with apiPassword first and skips undefined/null", () => {
		const xml = buildRequest("createPacket", "pw", {
			packetAttributes: { number: "1", cod: 0, value: 12.5, weight: 1, note: undefined, adultContent: true },
		})
		expect(xml).toBe(
			'<?xml version="1.0" encoding="utf-8"?><createPacket><apiPassword>pw</apiPassword><packetAttributes><number>1</number><cod>0</cod><value>12.5</value><weight>1</weight><adultContent>1</adultContent></packetAttributes></createPacket>',
		)
	})

	it("serialises arrays as repeated elements", () => {
		const xml = buildRequest("packetsLabelsPdf", "pw", {
			packetIds: { id: ["1", "2"] },
			format: "A6 on A6",
			offset: 0,
		})
		expect(xml).toContain("<packetIds><id>1</id><id>2</id></packetIds>")
	})

	it("formats numbers with at most two decimals", () => {
		expect(formatNumber(2)).toBe("2")
		expect(formatNumber(2.5)).toBe("2.5")
		expect(formatNumber(2.456)).toBe("2.46")
		expect(formatNumber(0.1 + 0.2)).toBe("0.3")
	})

	it("reads tags, blocks and flat records", () => {
		const xml = `<response><status>ok</status><result><id>123</id><barcode>Z123</barcode><record><statusCode>2</statusCode></record><record><statusCode>7</statusCode></record></result></response>`
		expect(readTag(xml, "status")).toBe("ok")
		expect(readTag(xml, "id")).toBe("123")
		expect(readTag(xml, "nope")).toBeUndefined()
		expect(readBlock(xml, "result")).toContain("<barcode>Z123</barcode>")
		expect(readBlocks(xml, "record")).toHaveLength(2)
		expect(readFlat("<a>1</a><b>x &amp; y</b>")).toEqual({ a: "1", b: "x & y" })
	})
})
