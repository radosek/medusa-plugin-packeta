/**
 * Minimal XML helpers for Packeta's REST/XML API. The API is flat and
 * predictable (no attributes, no namespaces, no CDATA on the request side),
 * so a purpose-built serialiser + tag reader keeps the plugin dependency-free.
 */

export type XmlValue = string | number | boolean | null | undefined | XmlNode | XmlValue[]
export interface XmlNode {
	[tag: string]: XmlValue
}

export function escapeXml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;")
}

export function unescapeXml(s: string): string {
	return s
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
		.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
		.replace(/&amp;/g, "&")
}

function serialise(tag: string, value: XmlValue): string {
	if (value === undefined || value === null) return ""
	if (Array.isArray(value)) return value.map((v) => serialise(tag, v)).join("")
	if (typeof value === "object") {
		return `<${tag}>${serialiseNode(value)}</${tag}>`
	}
	if (typeof value === "boolean") return `<${tag}>${value ? 1 : 0}</${tag}>`
	if (typeof value === "number") return `<${tag}>${formatNumber(value)}</${tag}>`
	return `<${tag}>${escapeXml(value)}</${tag}>`
}

function serialiseNode(node: XmlNode): string {
	let out = ""
	for (const [tag, value] of Object.entries(node)) out += serialise(tag, value)
	return out
}

/** Decimal with up to 2 fraction digits, no exponent, no trailing zeros noise. */
export function formatNumber(n: number): string {
	if (Number.isInteger(n)) return String(n)
	return n.toFixed(2).replace(/\.?0+$/, "")
}

/** Build a Packeta request document: `<method><apiPassword>…</apiPassword>…</method>`. */
export function buildRequest(method: string, apiPassword: string, args: XmlNode): string {
	return `<?xml version="1.0" encoding="utf-8"?><${method}><apiPassword>${escapeXml(apiPassword)}</apiPassword>${serialiseNode(args)}</${method}>`
}

/** First text content of `<tag>…</tag>` anywhere in the document (no nesting awareness). */
export function readTag(xml: string, tag: string): string | undefined {
	const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"))
	return m ? unescapeXml(m[1].trim()) : undefined
}

/** Raw inner XML of the first `<tag>` (nested content kept). */
export function readBlock(xml: string, tag: string): string | undefined {
	const m = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"))
	return m ? m[1] : undefined
}

/** All occurrences of a repeated `<tag>` block (raw inner XML). */
export function readBlocks(xml: string, tag: string): string[] {
	const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "gi")
	const out: string[] = []
	let m: RegExpExecArray | null
	while ((m = re.exec(xml))) out.push(m[1])
	return out
}

/** Text of every direct-ish child of a flat block, e.g. a StatusRecord. */
export function readFlat(block: string): Record<string, string> {
	const out: Record<string, string> = {}
	const re = /<([A-Za-z_][\w-]*)(?:\s[^>]*)?>([^<]*)<\/\1>/g
	let m: RegExpExecArray | null
	while ((m = re.exec(block))) out[m[1]] = unescapeXml(m[2].trim())
	return out
}
