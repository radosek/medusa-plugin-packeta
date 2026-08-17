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

/* ------------------------------------------------------------------ */
/* Nesting-aware reader                                                */
/* ------------------------------------------------------------------ */

export interface XmlElement {
	name: string
	children: XmlElement[]
	/** Concatenated, unescaped text content of this element (excluding children). */
	text: string
}

/**
 * Parse an XML document into an element tree. Handles declarations, comments,
 * CDATA, self-closing tags and entities; attributes are ignored (Packeta's API
 * carries no data in attributes). Returns the root element or `null`.
 */
export function parseXml(xml: string): XmlElement | null {
	const stack: XmlElement[] = []
	let root: XmlElement | null = null
	const re =
		/<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([A-Za-z_][\w.:-]*)\s*>|<([A-Za-z_][\w.:-]*)(?:\s[^>]*?)?(\/?)>|([^<]+)/g
	let m: RegExpExecArray | null
	while ((m = re.exec(xml))) {
		const [, cdata, close, open, selfClose, text] = m
		const top = stack[stack.length - 1]
		if (cdata !== undefined) {
			if (top) top.text += cdata
		} else if (close) {
			if (top && top.name === close) stack.pop()
		} else if (open) {
			const el: XmlElement = { name: open, children: [], text: "" }
			if (top) top.children.push(el)
			else if (!root) root = el
			if (!selfClose) stack.push(el)
		} else if (text !== undefined) {
			if (top) top.text += unescapeXml(text)
		}
	}
	return root
}

/** First direct child with the given name. */
export function child(el: XmlElement | null | undefined, name: string): XmlElement | undefined {
	return el?.children.find((c) => c.name === name)
}

/** All direct children with the given name. */
export function childrenNamed(el: XmlElement | null | undefined, name: string): XmlElement[] {
	return el?.children.filter((c) => c.name === name) ?? []
}

/** Text of a direct child, trimmed; `undefined` when absent. */
export function childText(el: XmlElement | null | undefined, name: string): string | undefined {
	const c = child(el, name)
	return c ? c.text.trim() : undefined
}

/** Depth-first search for the first element with the given name (including `el` itself). */
export function findFirst(el: XmlElement | null | undefined, name: string): XmlElement | undefined {
	if (!el) return undefined
	if (el.name === name) return el
	for (const c of el.children) {
		const hit = findFirst(c, name)
		if (hit) return hit
	}
	return undefined
}

/** `{ childName: text }` for every direct child that has no children of its own. */
export function flat(el: XmlElement | null | undefined): Record<string, string> {
	const out: Record<string, string> = {}
	for (const c of el?.children ?? []) if (!c.children.length) out[c.name] = c.text.trim()
	return out
}
