import { QzoneParseError } from '../errors.js'
import { parseJavaScriptLiteral } from '../internal/literal.js'
import { decodeHtmlEntities, extractScripts } from './html.js'
import { extractQzoneToken } from './token.js'
import { asRecord } from './value.js'

export interface ParsedPageHtml {
    readonly feed: unknown
    readonly token: string
}

export function parseIndexPageHtml(html: string): ParsedPageHtml {
    const script = frontPageScript(html)
    const payload = parseFrontPageData(script, '{')
    if (!asRecord(payload)) {
        throw new QzoneParseError('QQ 空间首页数据格式异常')
    }
    return Object.freeze({ feed: payload, token: extractQzoneToken(html) })
}

export function parseProfilePageHtml(html: string): ParsedPageHtml {
    const script = frontPageScript(html)
    const payload = parseFrontPageData(script, '[')
    if (!Array.isArray(payload) || payload.length < 2) {
        throw new QzoneParseError('QQ 空间用户页数据格式异常')
    }
    return Object.freeze({
        feed: unwrapData(payload[1]),
        token: extractQzoneToken(html)
    })
}

function frontPageScript(html: string): string {
    const script = extractScripts(html).find(
        (value) =>
            value.includes('shine0callback') && value.includes('FrontPage')
    )
    if (!script) {
        throw new QzoneParseError('QQ 空间页面缺少 FrontPage 数据')
    }
    return decodeHtmlEntities(script)
}

function parseFrontPageData(script: string, opening: '{' | '['): unknown {
    const marker = /\bvar\s+FrontPage\b[\s\S]*?\bdata\s*:\s*/gu.exec(script)
    if (!marker) {
        throw new QzoneParseError('QQ 空间页面缺少 Feed 数据')
    }
    const start = script.indexOf(opening, marker.index + marker[0].length)
    if (start < 0) {
        throw new QzoneParseError('QQ 空间页面 Feed 数据不完整')
    }
    const literal = extractBalancedLiteral(script, start, opening)
    return parseJavaScriptLiteral(literal)
}

function extractBalancedLiteral(
    source: string,
    start: number,
    opening: '{' | '['
): string {
    const closing = opening === '{' ? '}' : ']'
    let depth = 0
    let quote = ''
    let escaped = false
    let lineComment = false
    let blockComment = false

    for (let index = start; index < source.length; index += 1) {
        const character = source[index] ?? ''
        const next = source[index + 1] ?? ''
        if (lineComment) {
            if (character === '\n' || character === '\r') {
                lineComment = false
            }
            continue
        }
        if (blockComment) {
            if (character === '*' && next === '/') {
                blockComment = false
                index += 1
            }
            continue
        }
        if (quote) {
            if (escaped) {
                escaped = false
            } else if (character === '\\') {
                escaped = true
            } else if (character === quote) {
                quote = ''
            }
            continue
        }
        if (character === '"' || character === "'") {
            quote = character
        } else if (character === '/' && next === '/') {
            lineComment = true
            index += 1
        } else if (character === '/' && next === '*') {
            blockComment = true
            index += 1
        } else if (character === opening) {
            depth += 1
        } else if (character === closing) {
            depth -= 1
            if (depth === 0) {
                return source.slice(start, index + 1)
            }
        }
    }
    throw new QzoneParseError('QQ 空间页面 Feed 数据括号不完整')
}

function unwrapData(value: unknown): unknown {
    const record = asRecord(value)
    return record && record.data !== undefined ? record.data : value
}
