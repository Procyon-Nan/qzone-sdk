export function parseSetCookieHeaders(
    headers: Headers
): Map<string, string | null> {
    const getter = (
        headers as Headers & { getSetCookie?: () => readonly string[] }
    ).getSetCookie
    const rawValues =
        getter?.call(headers) ?? splitSetCookie(headers.get('set-cookie'))
    const updates = new Map<string, string | null>()

    for (const raw of rawValues) {
        const parts = raw.split(';')
        const separator = parts[0]?.indexOf('=') ?? -1
        if (separator <= 0 || !parts[0]) {
            continue
        }
        const key = parts[0].slice(0, separator).trim()
        const value = parts[0].slice(separator + 1).trim()
        const expired = parts.slice(1).some(isExpiredAttribute)
        if (key) {
            updates.set(key, !value || expired ? null : value)
        }
    }
    return updates
}

function isExpiredAttribute(attribute: string): boolean {
    const normalized = attribute.trim().toLowerCase()
    if (normalized === 'max-age=0') {
        return true
    }
    if (!normalized.startsWith('expires=')) {
        return false
    }
    const expiresAt = Date.parse(attribute.slice(attribute.indexOf('=') + 1))
    return !Number.isNaN(expiresAt) && expiresAt <= Date.now()
}

function splitSetCookie(value: string | null): readonly string[] {
    return value ? value.split(/,(?=\s*[^\s,;=]+=)/u) : []
}
