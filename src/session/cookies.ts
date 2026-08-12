import { QzoneValidationError } from '../errors.js'
import type { QzoneCookieInput, QzoneId } from '../types.js'

const COOKIE_ALIASES: Readonly<Record<string, string>> = {
    pskey: 'p_skey',
    gtk: 'g_tk',
    bkn: 'g_tk',
    csrf_token: 'g_tk'
}

const UIN_KEYS = ['uin', 'p_uin', 'ptui_loginuin', 'luin'] as const

export function parseCookies(input: QzoneCookieInput): Map<string, string> {
    if (typeof input !== 'string') {
        return normalizeCookies(Object.entries(input))
    }

    const text = input.trim()
    if (!text) {
        return new Map()
    }

    if (text.startsWith('{') || text.startsWith('[')) {
        return parseCookieJson(text)
    }

    const header = text.toLowerCase().startsWith('cookie:')
        ? text.slice(text.indexOf(':') + 1).trim()
        : text
    const entries: Array<readonly [string, unknown]> = []

    for (const part of header.split(/[;\r\n]+/u)) {
        const separator = part.indexOf('=')
        if (separator < 0) {
            continue
        }

        entries.push([part.slice(0, separator), part.slice(separator + 1)])
    }

    return normalizeCookies(entries)
}

export function parseAccountId(
    cookies: ReadonlyMap<string, string>
): QzoneId | null {
    let accountId: QzoneId | null = null

    for (const key of UIN_KEYS) {
        const value = cookies.get(key)
        if (!value) {
            continue
        }

        const normalized = value.trim().replace(/^[oO]+/u, '')
        if (/^\d+$/u.test(normalized)) {
            if (accountId && normalized !== accountId) {
                throw new QzoneValidationError('Cookie 中的账号字段不一致')
            }
            accountId = normalized
        }
    }

    return accountId
}

export function serializeCookies(cookies: ReadonlyMap<string, string>): string {
    return [...cookies].map(([key, value]) => `${key}=${value}`).join('; ')
}

export function mergeCookies(
    cookies: ReadonlyMap<string, string>,
    updates: ReadonlyMap<string, string | null>
): Map<string, string> {
    const merged = new Map(cookies)

    for (const [key, value] of updates) {
        const canonical = canonicalCookieKey(key)
        for (const existingKey of merged.keys()) {
            if (canonicalCookieKey(existingKey) === canonical) {
                merged.delete(existingKey)
            }
        }
        if (value !== null) {
            merged.set(key, value)
        }
    }

    return normalizeCookies(merged)
}

function parseCookieJson(text: string): Map<string, string> {
    let value: unknown
    try {
        value = JSON.parse(text)
    } catch (cause) {
        throw new QzoneValidationError('Cookie JSON 格式无效', { cause })
    }

    if (!isRecord(value)) {
        throw new QzoneValidationError('Cookie JSON 必须是对象')
    }

    return normalizeCookies(Object.entries(value))
}

function normalizeCookies(
    entries: Iterable<readonly [string, unknown]>
): Map<string, string> {
    const cookies = new Map<string, string>()

    for (const [rawKey, rawValue] of entries) {
        if (rawValue === null || rawValue === undefined) {
            continue
        }

        const key = rawKey.trim()
        const value = String(rawValue).trim().replace(/^"|"$/gu, '')
        if (!key || !value) {
            continue
        }

        cookies.set(key, value)
    }

    for (const [key, value] of cookies) {
        const canonical = canonicalCookieKey(key)
        if (canonical && !cookies.has(canonical)) {
            cookies.set(canonical, value)
        }
    }

    const uin = cookies.get('uin')
    const privateUin = cookies.get('p_uin')
    if (uin && !privateUin) {
        cookies.set('p_uin', uin)
    } else if (privateUin && !uin) {
        cookies.set('uin', privateUin)
    }

    return cookies
}

function canonicalCookieKey(key: string): string {
    const normalized = key.toLowerCase().replaceAll('-', '_')
    return COOKIE_ALIASES[normalized] ?? key
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
