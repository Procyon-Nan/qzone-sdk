import {
    QzoneAuthError,
    QzoneCancelledError,
    QzoneError,
    QzonePermissionError,
    QzoneRateLimitError,
    QzoneRequestError
} from '../errors.js'
import { SessionState } from '../session/session.js'
import type { QzoneLogger } from '../types.js'
import {
    AttemptFailure,
    combineSignals,
    delay,
    throwIfAborted
} from './abort.js'
import {
    isAllowedRedirect,
    isHomeRedirect,
    isLoginRedirect,
    isRedirectStatus,
    preserveQuery,
    resolveRedirect
} from './redirect.js'
import {
    buildHeaders,
    buildUrl,
    DEFAULT_USER_AGENT,
    encodeParameters,
    positiveInteger,
    validateRequest
} from './request.js'
import { createDiagnosticSnippet, parseResponseData } from './response.js'
import { parseSetCookieHeaders } from './set-cookie.js'
import type {
    TransportEndpoint,
    TransportRequestOptions,
    TransportResponse
} from './types.js'

const DEFAULT_TIMEOUT_MS = 15_000
const DEFAULT_READ_ATTEMPTS = 3

export interface FetchTransportOptions {
    readonly session: SessionState
    readonly fetch?: typeof globalThis.fetch
    readonly logger?: QzoneLogger
    readonly userAgent?: string
    readonly timeoutMs?: number
    readonly maxReadAttempts?: number
    readonly retryDelayMs?: (retryCount: number) => number
}

export class UncertainTransportError extends QzoneRequestError {}

export class FetchTransport {
    readonly #session: SessionState
    readonly #fetch: typeof globalThis.fetch
    readonly #logger?: QzoneLogger
    readonly #userAgent: string
    readonly #timeoutMs: number
    readonly #maxReadAttempts: number
    readonly #retryDelayMs: (retryCount: number) => number

    constructor(options: FetchTransportOptions) {
        this.#session = options.session
        this.#fetch = options.fetch ?? globalThis.fetch
        this.#logger = options.logger
        this.#userAgent = options.userAgent?.trim() || DEFAULT_USER_AGENT
        this.#timeoutMs = positiveInteger(
            options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            '请求超时时间'
        )
        this.#maxReadAttempts = positiveInteger(
            options.maxReadAttempts ?? DEFAULT_READ_ATTEMPTS,
            '读取请求最大尝试次数'
        )
        this.#retryDelayMs =
            options.retryDelayMs ??
            ((retryCount) => 100 * 2 ** (retryCount - 1))
    }

    async request(
        endpoint: TransportEndpoint,
        options: TransportRequestOptions = {}
    ): Promise<TransportResponse> {
        validateRequest(endpoint, options)
        this.#assertAuthenticated(endpoint)
        throwIfAborted(options.signal, endpoint.id)

        const attempts =
            endpoint.operation === 'read' ? this.#maxReadAttempts : 1

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
            const startedAt = Date.now()
            this.#log({
                level: 'debug',
                phase: 'request.start',
                endpoint: endpoint.id,
                retryCount: attempt - 1
            })

            try {
                const response = await this.#requestWithRedirects(
                    endpoint,
                    options
                )
                await this.#persistCookies(response.headers, endpoint.id)

                if (response.status >= 500 && attempt < attempts) {
                    this.#logRetry(endpoint.id, attempt, response.status)
                    await delay(this.#retryDelayMs(attempt), options.signal)
                    continue
                }

                this.#throwForStatus(endpoint, response)
                this.#log({
                    level: 'info',
                    phase: 'request.complete',
                    endpoint: endpoint.id,
                    durationMs: Date.now() - startedAt,
                    retryCount: attempt - 1,
                    statusCode: response.status
                })
                return response
            } catch (error) {
                let failure: QzoneError
                if (error instanceof AttemptFailure) {
                    if (
                        endpoint.operation === 'read' &&
                        error.kind !== 'cancelled' &&
                        attempt < attempts
                    ) {
                        this.#logRetry(endpoint.id, attempt)
                        await delay(this.#retryDelayMs(attempt), options.signal)
                        continue
                    }
                    failure = this.#mapAttemptFailure(
                        endpoint,
                        error,
                        attempt - 1
                    )
                } else if (error instanceof PersistenceFailure) {
                    if (endpoint.operation === 'write') {
                        failure = new UncertainTransportError(
                            '写请求已响应，但 Session 持久化失败',
                            {
                                cause: error.cause,
                                context: { endpoint: endpoint.id }
                            }
                        )
                    } else {
                        failure = error.cause
                    }
                } else if (error instanceof QzoneError) {
                    failure = error
                } else {
                    failure = new QzoneRequestError('QQ 空间请求失败', {
                        cause: error,
                        context: {
                            endpoint: endpoint.id,
                            retryCount: attempt - 1
                        }
                    })
                }
                this.#logFailure(endpoint.id, startedAt, attempt - 1, failure)
                throw failure
            }
        }

        throw new QzoneRequestError('QQ 空间请求失败', {
            context: { endpoint: endpoint.id }
        })
    }

    async requestData(
        endpoint: TransportEndpoint,
        options: TransportRequestOptions = {}
    ): Promise<unknown> {
        const response = await this.request(endpoint, options)
        return parseResponseData(response.text, endpoint.id)
    }

    async #requestWithRedirects(
        endpoint: TransportEndpoint,
        options: TransportRequestOptions
    ): Promise<TransportResponse> {
        let url = buildUrl(endpoint, options.query, this.#session)
        const initialQuery = new URLSearchParams(url.searchParams)

        for (let redirects = 0; ; redirects += 1) {
            const result = await this.#send(endpoint, url, options)

            if (!isRedirectStatus(result.status)) {
                return result
            }

            await this.#persistCookies(result.headers, endpoint.id)
            const location = result.headers.get('location')
            const target = resolveRedirect(url, location, endpoint.id)
            if (isLoginRedirect(target)) {
                throw new QzoneAuthError('QQ 空间登录态已失效', {
                    context: statusContext(endpoint.id, result.status)
                })
            }
            const acceptedWriteRedirect =
                endpoint.redirect === 'qq-write-accepted' &&
                isAllowedRedirect(url, target, redirects)
            if (
                isHomeRedirect(target, this.#session.accountId) &&
                !acceptedWriteRedirect
            ) {
                throw new QzoneRequestError('QQ 空间接口跳转到异常主页', {
                    context: statusContext(endpoint.id, result.status)
                })
            }
            if (
                acceptedWriteRedirect &&
                (!endpoint.redirectFollowPath ||
                    !target.pathname.startsWith(endpoint.redirectFollowPath))
            ) {
                return result
            }
            if (
                endpoint.redirect === 'none' ||
                !isAllowedRedirect(url, target, redirects)
            ) {
                throw new QzoneRequestError('QQ 空间接口返回不允许的重定向', {
                    context: statusContext(endpoint.id, result.status)
                })
            }

            preserveQuery(target, initialQuery)
            url = target
        }
    }

    async #send(
        endpoint: TransportEndpoint,
        url: URL,
        options: TransportRequestOptions
    ): Promise<TransportResponse> {
        throwIfAborted(options.signal, endpoint.id)
        const headers = buildHeaders(
            endpoint,
            options,
            this.#session,
            this.#userAgent
        )
        const body = options.form ? encodeParameters(options.form) : undefined
        if (body && !headers.has('content-type')) {
            headers.set(
                'content-type',
                'application/x-www-form-urlencoded;charset=UTF-8'
            )
        }

        const signals = combineSignals(options.signal, this.#timeoutMs)
        try {
            const response = await Promise.race([
                this.#fetch(url, {
                    method: endpoint.method,
                    headers,
                    body,
                    redirect: 'manual',
                    signal: signals.signal
                }),
                signals.aborted
            ])
            const text = await Promise.race([response.text(), signals.aborted])
            return {
                status: response.status,
                url: url.toString(),
                headers: response.headers,
                text
            }
        } catch (cause) {
            const kind = options.signal?.aborted
                ? 'cancelled'
                : signals.timedOut()
                  ? 'timeout'
                  : 'network'
            throw new AttemptFailure(kind, cause)
        } finally {
            signals.cleanup()
        }
    }

    async #persistCookies(headers: Headers, endpoint: string): Promise<void> {
        const updates = parseSetCookieHeaders(headers)
        if (updates.size > 0) {
            try {
                await this.#session.mergeCookieUpdates(updates)
            } catch (cause) {
                throw new PersistenceFailure(
                    cause instanceof QzoneError
                        ? cause
                        : new QzoneRequestError('Session Cookie 更新失败', {
                              cause
                          }),
                    endpoint
                )
            }
        }
    }

    #assertAuthenticated(endpoint: TransportEndpoint): void {
        if (endpoint.authentication !== 'required') {
            return
        }
        if (!this.#session.accountId || !this.#session.cookieHeader) {
            throw new QzoneAuthError('QQ 空间请求缺少 Session')
        }
        if (endpoint.includeGtk && this.#session.gtk === 0) {
            throw new QzoneAuthError('Cookie 无法计算 g_tk')
        }
        if (
            endpoint.tokenAccountId &&
            !this.#session.getToken(endpoint.tokenAccountId)
        ) {
            throw new QzoneAuthError('QQ 空间请求缺少 qzonetoken')
        }
    }

    #throwForStatus(
        endpoint: TransportEndpoint,
        response: TransportResponse
    ): void {
        const context = {
            ...statusContext(endpoint.id, response.status),
            responseSnippet: createDiagnosticSnippet(response.text)
        }
        if (response.status === 401) {
            throw new QzoneAuthError('QQ 空间登录态已失效', { context })
        }
        if (response.status === 403) {
            throw new QzonePermissionError('QQ 空间拒绝访问', { context })
        }
        if (response.status === 429) {
            throw new QzoneRateLimitError('QQ 空间请求过于频繁', { context })
        }
        if (response.status >= 400) {
            throw new QzoneRequestError(
                `QQ 空间请求返回 HTTP ${response.status}`,
                { context }
            )
        }
    }

    #mapAttemptFailure(
        endpoint: TransportEndpoint,
        failure: AttemptFailure,
        retryCount: number
    ): QzoneError {
        const options = {
            cause: failure.cause,
            context: { endpoint: endpoint.id, retryCount }
        }
        if (endpoint.operation === 'write') {
            return new UncertainTransportError('写请求结果无法确认', options)
        }
        if (failure.kind === 'cancelled') {
            return new QzoneCancelledError(
                'Qzone operation was cancelled',
                options
            )
        }
        return new QzoneRequestError(
            failure.kind === 'timeout'
                ? 'QQ 空间请求超时'
                : 'QQ 空间网络请求失败',
            options
        )
    }

    #logRetry(endpoint: string, retryCount: number, statusCode?: number): void {
        this.#log({
            level: 'warn',
            phase: 'request.retry',
            endpoint,
            retryCount,
            statusCode
        })
    }

    #logFailure(
        endpoint: string,
        startedAt: number,
        retryCount: number,
        error: QzoneError
    ): void {
        this.#log({
            level: 'error',
            phase: 'request.error',
            endpoint,
            durationMs: Date.now() - startedAt,
            retryCount,
            ...(error.context?.statusCode !== undefined
                ? { statusCode: error.context.statusCode }
                : {}),
            errorCode: error.code
        })
    }

    #log(event: Parameters<QzoneLogger>[0]): void {
        try {
            this.#logger?.(Object.freeze({ ...event }))
        } catch {
            // Logging must not affect protocol behavior.
        }
    }
}

class PersistenceFailure extends Error {
    constructor(
        readonly cause: QzoneError,
        endpoint: string
    ) {
        super(`Session persistence failed for ${endpoint}`)
    }
}

function statusContext(endpoint: string, statusCode: number) {
    return { endpoint, statusCode }
}
