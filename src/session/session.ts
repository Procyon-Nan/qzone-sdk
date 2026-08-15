import {
    QzoneAuthError,
    QzoneRequestError,
    QzoneValidationError
} from '../errors.js'
import type {
    QzoneId,
    QzoneSession,
    QzoneSessionInput,
    SessionChangeHandler,
    SessionInfo
} from '../types.js'
import {
    mergeCookies,
    parseAccountId,
    parseCookies,
    serializeCookies
} from './cookies.js'
import { computeGtk } from './gtk.js'

export interface SessionStateOptions {
    readonly onSessionChange?: SessionChangeHandler
    readonly now?: () => Date
}

export class SessionState {
    readonly #onSessionChange?: SessionChangeHandler
    readonly #now: () => Date
    readonly #boundAccountId: QzoneId
    #accountId: QzoneId | null = null
    #cookies = new Map<string, string>()
    #tokens = new Map<QzoneId, string>()
    #updatedAt: string | null = null
    #persistencePending = false
    #persistenceTail: Promise<void> = Promise.resolve()
    #closed = false

    constructor(input: QzoneSessionInput, options: SessionStateOptions = {}) {
        this.#onSessionChange = options.onSessionChange
        this.#now = options.now ?? (() => new Date())
        const session = normalizeSessionInput(input, this.#now)
        this.#boundAccountId = session.accountId
        this.#apply(session)
    }

    get accountId(): QzoneId | null {
        return this.#accountId
    }

    get cookieHeader(): string {
        return serializeCookies(this.#cookies)
    }

    get gtk(): number {
        return computeGtk(this.#cookies)
    }

    get closed(): boolean {
        return this.#closed
    }

    getToken(accountId: QzoneId): string | undefined {
        return this.#tokens.get(accountId)
    }

    getCookie(name: string): string | undefined {
        return this.#cookies.get(name)
    }

    getInfo(): SessionInfo {
        return {
            accountId: this.#accountId,
            authenticated: this.#accountId !== null && this.gtk !== 0,
            updatedAt: this.#updatedAt,
            persistencePending: this.#persistencePending
        }
    }

    export(): QzoneSession {
        if (!this.#accountId || !this.#updatedAt) {
            throw new QzoneAuthError('当前没有可导出的 Session')
        }

        return {
            accountId: this.#accountId,
            cookies: Object.freeze(Object.fromEntries(this.#cookies)),
            tokens: Object.freeze(Object.fromEntries(this.#tokens)),
            updatedAt: this.#updatedAt
        }
    }

    async update(input: QzoneSessionInput): Promise<void> {
        this.#assertOpen()
        const session = normalizeSessionInput(input, this.#now)
        if (session.accountId !== this.#boundAccountId) {
            throw new QzoneValidationError('不能将 Session 更新为其他账号')
        }
        this.#apply(session)
        await this.#notifyChange()
    }

    async setToken(accountId: QzoneId, token: string): Promise<void> {
        this.#assertOpen()
        const normalizedAccountId = normalizeAccountId(accountId, 'Token 账号')
        const normalizedToken = token.trim()
        if (!normalizedToken) {
            throw new QzoneValidationError('Token 不能为空')
        }
        if (this.#tokens.get(normalizedAccountId) === normalizedToken) {
            return
        }

        this.#tokens.set(normalizedAccountId, normalizedToken)
        this.#touch()
        await this.#notifyChange()
    }

    async mergeCookieUpdates(
        updates: ReadonlyMap<string, string | null>
    ): Promise<void> {
        this.#assertOpen()
        if (!this.#accountId || !this.#updatedAt || updates.size === 0) {
            return
        }

        const session = normalizeSessionInput(
            {
                accountId: this.#boundAccountId,
                cookies: Object.fromEntries(
                    mergeCookies(this.#cookies, updates)
                ),
                tokens: Object.fromEntries(this.#tokens)
            },
            this.#now
        )
        this.#apply(session)
        await this.#notifyChange()
    }

    clear(): void {
        this.#cookies.clear()
        this.#tokens.clear()
        this.#accountId = null
        this.#updatedAt = null
        this.#persistencePending = false
    }

    close(): void {
        this.clear()
        this.#closed = true
    }

    #apply(session: NormalizedSession): void {
        this.#accountId = session.accountId
        this.#cookies = session.cookies
        this.#tokens = session.tokens
        this.#updatedAt = session.updatedAt
    }

    #touch(): void {
        this.#updatedAt = this.#now().toISOString()
    }

    async #notifyChange(): Promise<void> {
        const onSessionChange = this.#onSessionChange
        if (!onSessionChange) {
            this.#persistencePending = false
            return
        }

        const snapshot = this.export()
        const persistence = this.#persistenceTail.then(async () => {
            try {
                await onSessionChange(snapshot)
                this.#persistencePending = false
            } catch (cause) {
                this.#persistencePending = true
                throw new QzoneRequestError('Session 持久化回调执行失败', {
                    cause,
                    context: { operation: 'session.persist' }
                })
            }
        })
        this.#persistenceTail = persistence.then(
            () => undefined,
            () => undefined
        )
        await persistence
    }

    #assertOpen(): void {
        if (this.#closed) {
            throw new QzoneValidationError('Session 已关闭')
        }
    }
}

interface NormalizedSession {
    readonly accountId: QzoneId
    readonly cookies: Map<string, string>
    readonly tokens: Map<QzoneId, string>
    readonly updatedAt: string
}

function normalizeSessionInput(
    input: QzoneSessionInput,
    now: () => Date
): NormalizedSession {
    const cookies = parseCookies(input.cookies)
    const cookieAccountId = parseAccountId(cookies)
    const declaredAccountId = input.accountId
        ? normalizeAccountId(input.accountId, '声明账号')
        : null

    if (
        cookieAccountId &&
        declaredAccountId &&
        cookieAccountId !== declaredAccountId
    ) {
        throw new QzoneValidationError('Cookie 账号与声明账号不一致')
    }

    const accountId = cookieAccountId ?? declaredAccountId
    if (!accountId) {
        throw new QzoneValidationError('无法从 Session 中确定账号')
    }

    return {
        accountId,
        cookies,
        tokens: normalizeTokens(input.tokens),
        updatedAt: normalizeTimestamp(input.updatedAt, now)
    }
}

function normalizeAccountId(value: QzoneId, label: string): QzoneId {
    const normalized = value.trim().replace(/^[oO]+/u, '')
    if (!/^\d+$/u.test(normalized)) {
        throw new QzoneValidationError(`${label}必须是十进制数字字符串`)
    }
    return normalized
}

function normalizeTokens(
    tokens: QzoneSessionInput['tokens']
): Map<QzoneId, string> {
    const normalized = new Map<QzoneId, string>()
    for (const [accountId, rawToken] of Object.entries(tokens ?? {})) {
        const token = rawToken.trim()
        if (token) {
            normalized.set(normalizeAccountId(accountId, 'Token 账号'), token)
        }
    }
    return normalized
}

function normalizeTimestamp(
    value: string | undefined,
    now: () => Date
): string {
    if (!value) {
        return now().toISOString()
    }

    const timestamp = new Date(value)
    if (Number.isNaN(timestamp.getTime())) {
        throw new QzoneValidationError('Session 更新时间必须是有效时间')
    }
    return timestamp.toISOString()
}
