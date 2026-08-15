import { decodeHtmlEntities } from './html.js'

export type ProtocolRecord = Readonly<Record<string, unknown>>

export function asRecord(value: unknown): ProtocolRecord | null {
    if (isRecord(value)) {
        return value
    }
    if (typeof value !== 'string') {
        return null
    }
    const text = decodeHtmlEntities(value).trim()
    if (!text.startsWith('{') || text.length > 200_000) {
        return null
    }
    try {
        const parsed: unknown = JSON.parse(text)
        return isRecord(parsed) ? parsed : null
    } catch {
        return null
    }
}

export function asRecords(value: unknown): readonly ProtocolRecord[] {
    if (Array.isArray(value)) {
        return value.flatMap((item) => {
            const record = asRecord(item)
            return record ? [record] : []
        })
    }
    const record = asRecord(value)
    if (!record) {
        return []
    }
    return [record]
}

export function asRecordValues(value: unknown): readonly ProtocolRecord[] {
    const record = asRecord(value)
    if (!record) {
        return []
    }
    return Object.values(record).flatMap((item) => {
        const child = asRecord(item)
        return child ? [child] : []
    })
}

export function firstRecord(
    record: ProtocolRecord,
    keys: readonly string[]
): ProtocolRecord | null {
    for (const key of keys) {
        const value = asRecord(record[key])
        if (value) {
            return value
        }
    }
    return null
}

export function firstValue(
    record: ProtocolRecord,
    keys: readonly string[]
): unknown {
    for (const key of keys) {
        const value = record[key]
        if (value !== null && value !== undefined && value !== '') {
            return value
        }
    }
    return undefined
}

export function toText(value: unknown): string {
    if (typeof value === 'string') {
        return value
    }
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value)
    }
    const record = asRecord(value)
    if (record) {
        return toText(
            firstValue(record, ['summary', 'content', 'text', 'msg', 'title'])
        )
    }
    if (Array.isArray(value)) {
        return value.map(toText).join('')
    }
    return ''
}

export function toId(value: unknown): string {
    const text = toText(value)
        .trim()
        .replace(/^[oO]+/u, '')
    return /^\d+$/u.test(text) ? text : ''
}

export function toInteger(value: unknown, fallback = 0): number {
    const number =
        typeof value === 'number' ? value : Number.parseInt(toText(value), 10)
    return Number.isSafeInteger(number) ? number : fallback
}

export function toBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value
    }
    if (typeof value === 'number') {
        return value !== 0
    }
    const normalized = toText(value).trim().toLowerCase()
    return ['1', 'true', 'yes', 'y'].includes(normalized)
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
