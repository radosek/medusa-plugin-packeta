import {
	buildRequest,
	child,
	childrenNamed,
	childText,
	escapeXml,
	findFirst,
	flat,
	formatNumber,
	parseXml,
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

	it("parses nested documents into a tree and reads direct children only", () => {
		const xml = `<?xml version="1.0"?><!-- c --><response><status>ok</status><result><id>123</id><barcode>Z123</barcode><courierInfo><courierInfoItem><id>999</id></courierInfoItem></courierInfo><record><statusCode>2</statusCode><note><![CDATA[a < b]]></note></record><record><statusCode>7</statusCode><empty/></record><text>x &amp; y</text></result></response>`
		const root = parseXml(xml)!
		expect(root.name).toBe("response")
		expect(childText(root, "status")).toBe("ok")
		const result = child(root, "result")!
		// direct child wins over the nested courierInfoItem/id
		expect(childText(result, "id")).toBe("123")
		expect(childText(result, "nope")).toBeUndefined()
		expect(childrenNamed(result, "record")).toHaveLength(2)
		expect(flat(childrenNamed(result, "record")[0])).toEqual({ statusCode: "2", note: "a < b" })
		expect(flat(result)).toEqual({ id: "123", barcode: "Z123", text: "x & y" })
		expect(findFirst(result, "courierInfoItem")?.children[0].text).toBe("999")
		expect(parseXml("")).toBeNull()
	})
})
