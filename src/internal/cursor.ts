import { QzoneValidationError } from '../errors.js'
import type { FeedScope, QzoneId } from '../types.js'

const CURSOR_VERSION = 1
const MAX_CURSOR_ENTRIES = 256

export interface FeedCursorContext {
    readonly accountId: QzoneId
    readonly scope: FeedScope
    readonly targetId: QzoneId
}

export interface FeedCursorPosition {
    readonly source: string
    readonly backendCursor: string
    readonly page: number
    readonly beginTime: number
    readonly pageSize: number
}

interface CursorPayload extends FeedCursorContext, FeedCursorPosition {
    readonly version: number
    readonly instanceId: string
    readonly entryId: string
}

interface StoredCursor<T> {
    readonly encoded: string
    readonly value: T
}

export class FeedCursorStore<T> {
    readonly #instanceId = crypto.randomUUID()
    readonly #entries = new Map<string, StoredCursor<T>>()

    create(
        context: FeedCursorContext,
        position: FeedCursorPosition,
        value: T
    ): string {
        const payload: CursorPayload = {
            version: CURSOR_VERSION,
            instanceId: this.#instanceId,
            entryId: crypto.randomUUID(),
            ...context,
            ...position
        }
        const encoded = encodePayload(payload)
        this.#entries.set(payload.entryId, { encoded, value })
        if (this.#entries.size > MAX_CURSOR_ENTRIES) {
            const oldest = this.#entries.keys().next().value
            if (oldest) {
                this.#entries.delete(oldest)
            }
        }
        return encoded
    }

    read(cursor: string, context: FeedCursorContext): T {
        const payload = decodePayload(cursor)
        if (
            payload.instanceId !== this.#instanceId ||
            payload.accountId !== context.accountId ||
            payload.scope !== context.scope ||
            payload.targetId !== context.targetId
        ) {
            throw invalidCursor()
        }
        const stored = this.#entries.get(payload.entryId)
        if (!stored || stored.encoded !== cursor) {
            throw invalidCursor()
        }
        return stored.value
    }

    clear(): void {
        this.#entries.clear()
    }
}

function encodePayload(payload: CursorPayload): string {
    const bytes = new TextEncoder().encode(JSON.stringify(payload))
    let binary = ''
    for (const byte of bytes) {
        binary += String.fromCharCode(byte)
    }
    return `qz1.${btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/gu, '')}`
}

function decodePayload(cursor: string): CursorPayload {
    if (!cursor.startsWith('qz1.') || cursor.length > 4_096) {
        throw invalidCursor()
    }
    try {
        const encoded = cursor.slice(4).replace(/-/gu, '+').replace(/_/gu, '/')
        const binary = atob(
            encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
        )
        const bytes = Uint8Array.from(binary, (character) =>
            character.charCodeAt(0)
        )
        const value: unknown = JSON.parse(new TextDecoder().decode(bytes))
        if (!isCursorPayload(value)) {
            throw invalidCursor()
        }
        return value
    } catch (cause) {
        if (cause instanceof QzoneValidationError) {
            throw cause
        }
        throw invalidCursor(cause)
    }
}

function isCursorPayload(value: unknown): value is CursorPayload {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return false
    }
    const payload = value as Partial<CursorPayload>
    return (
        payload.version === CURSOR_VERSION &&
        typeof payload.instanceId === 'string' &&
        typeof payload.entryId === 'string' &&
        typeof payload.accountId === 'string' &&
        ['self', 'profile', 'friends'].includes(payload.scope ?? '') &&
        typeof payload.targetId === 'string' &&
        typeof payload.source === 'string' &&
        typeof payload.backendCursor === 'string' &&
        isNonNegativeInteger(payload.page) &&
        isNonNegativeInteger(payload.beginTime) &&
        isNonNegativeInteger(payload.pageSize)
    )
}

function isNonNegativeInteger(value: unknown): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 0
}

function invalidCursor(cause?: unknown): QzoneValidationError {
    return new QzoneValidationError('动态分页游标无效或不属于当前请求', {
        cause
    })
}
