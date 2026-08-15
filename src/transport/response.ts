import { QzoneParseError } from '../errors.js'
import { parseJavaScriptLiteral } from '../internal/literal.js'

const JSONP_PATTERN =
    /^(?:[A-Za-z_$][\w$]*\.)*[A-Za-z_$][\w$]*\s*\(\s*([\s\S]*)\s*\)\s*;?$/u
const MAX_DIAGNOSTIC_LENGTH = 200

export function parseResponseData(text: string, endpoint?: string): unknown {
    const normalized = text.trim()
    if (!normalized) {
        return {}
    }

    const jsonp = JSONP_PATTERN.exec(normalized)
    const json = jsonp?.[1] ?? normalized

    try {
        return JSON.parse(json)
    } catch (jsonCause) {
        try {
            return parseJavaScriptLiteral(json)
        } catch (literalCause) {
            throw new QzoneParseError('QQ 空间响应不是有效的 JSON 或 JSONP', {
                cause: literalCause ?? jsonCause,
                context: {
                    endpoint,
                    responseSnippet: createDiagnosticSnippet(normalized)
                }
            })
        }
    }
}

export function createDiagnosticSnippet(text: string): string {
    return text
        .replace(
            /\b(p_skey|skey|pskey|qzonetoken|g_tk|cookie)\b\s*[:=]\s*["']?[^\s,;&}"']+/giu,
            '$1=[REDACTED]'
        )
        .slice(0, MAX_DIAGNOSTIC_LENGTH)
}
