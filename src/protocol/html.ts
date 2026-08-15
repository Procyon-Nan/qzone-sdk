const ENTITY_VALUES: Readonly<Record<string, string>> = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    nbsp: '\u00a0',
    quot: '"'
}

export function decodeHtmlEntities(value: string): string {
    return value.replace(
        /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
        (entity, decimal: string, hexadecimal: string, named: string) => {
            const codePoint = decimal
                ? Number.parseInt(decimal, 10)
                : hexadecimal
                  ? Number.parseInt(hexadecimal, 16)
                  : null
            if (codePoint !== null) {
                try {
                    return String.fromCodePoint(codePoint)
                } catch {
                    return entity
                }
            }
            return ENTITY_VALUES[named.toLowerCase()] ?? entity
        }
    )
}

export function htmlToText(value: string): string {
    return decodeHtmlEntities(
        value
            .replace(/<\s*br\s*\/?\s*>/giu, '\n')
            .replace(/<\/\s*(?:p|div|li|tr)\s*>/giu, '\n')
            .replace(/<[^>]+>/gu, '')
    )
        .replace(/[ \t\r\f\v]+/gu, ' ')
        .replace(/ *\n */gu, '\n')
        .replace(/\n{3,}/gu, '\n\n')
        .trim()
}

export function extractHtmlAttribute(
    markup: string,
    attribute: string
): string {
    const escaped = attribute.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const pattern = new RegExp(
        `\\b${escaped}\\s*=\\s*(?:(["'])(.*?)\\1|([^\\s"'<>\u0060]+))`,
        'isu'
    )
    const match = pattern.exec(markup)
    return decodeHtmlEntities(match?.[2] ?? match?.[3] ?? '').trim()
}

export function extractClassText(markup: string, className: string): string {
    const escaped = className.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
    const pattern = new RegExp(
        `<(?<tag>[a-z0-9]+)\\b[^>]*class\\s*=\\s*["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>(?<body>.*?)<\\/\\k<tag>>`,
        'isu'
    )
    return htmlToText(pattern.exec(markup)?.groups?.body ?? '')
}

export function extractScripts(html: string): readonly string[] {
    return [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/giu)].map(
        (match) => match[1] ?? ''
    )
}
