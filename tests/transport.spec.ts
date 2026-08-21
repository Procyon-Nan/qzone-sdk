import { describe, expect, it, vi } from 'vitest'

import {
    QzoneAuthError,
    QzoneCancelledError,
    QzonePermissionError,
    QzoneRateLimitError,
    QzoneRequestError
} from '../src/index.js'
import { SessionState } from '../src/session/session.js'
import type { QzoneLogger } from '../src/types.js'
import {
    FetchTransport,
    UncertainTransportError
} from '../src/transport/fetch-transport.js'
import type { TransportEndpoint } from '../src/transport/types.js'
import { createFakeFetch } from './support/fake-fetch.js'
import { jsonResponse, textResponse } from './support/fixtures.js'

const READ_ENDPOINT: TransportEndpoint = {
    id: 'feed.list',
    method: 'GET',
    url: 'https://h5.qzone.qq.com/feed',
    operation: 'read',
    authentication: 'required',
    includeGtk: true,
    tokenAccountId: '10001',
    referer: 'https://h5.qzone.qq.com/',
    origin: 'https://h5.qzone.qq.com',
    redirect: 'qq'
}

const WRITE_ENDPOINT: TransportEndpoint = {
    ...READ_ENDPOINT,
    id: 'post.publish',
    method: 'POST',
    operation: 'write'
}

describe('Fetch transport', () => {
    it('builds authenticated query, headers and form requests', async () => {
        const fake = createFakeFetch([
            (request) => {
                expect(request.headers.get('cookie')).toContain('p_skey=secret')
                expect(request.headers.get('referer')).toBe(
                    'https://h5.qzone.qq.com/'
                )
                expect(request.headers.get('origin')).toBe(
                    'https://h5.qzone.qq.com'
                )
                expect(request.headers.get('user-agent')).toBe(
                    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
                        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
                        'Chrome/122.0.0.0 Safari/537.36'
                )
                expect(request.url).toContain('g_tk=')
                expect(request.url).toContain('qzonetoken=token')
                expect(request.url).toContain('limit=10')
                return jsonResponse({ ok: true })
            },
            async (request) => {
                expect(await request.text()).toBe('content=a+b&enabled=true')
                return jsonResponse({ ok: true })
            }
        ])
        const transport = createTransport(fake.fetch)

        expect(
            await transport.requestData(READ_ENDPOINT, {
                query: { limit: 10 }
            })
        ).toEqual({ ok: true })
        await transport.request(WRITE_ENDPOINT, {
            form: { content: 'a b', enabled: true }
        })

        expect(fake.calls).toHaveLength(2)
    })

    it('allows the caller to override the default browser User-Agent', async () => {
        const fake = createFakeFetch([
            (request) => {
                expect(request.headers.get('user-agent')).toBe('Custom UA')
                return jsonResponse({ ok: true })
            }
        ])

        await createTransport(fake.fetch, { userAgent: 'Custom UA' }).request(
            READ_ENDPOINT
        )
    })

    it('merges Set-Cookie and notifies persistence', async () => {
        const onSessionChange = vi.fn()
        const session = createSession(onSessionChange)
        const fake = createFakeFetch([
            textResponse('', {
                headers: { 'set-cookie': 'new_cookie=value; Path=/; HttpOnly' }
            })
        ])
        const transport = createTransport(fake.fetch, { session })

        await transport.request(READ_ENDPOINT)

        expect(session.export().cookies.new_cookie).toBe('value')
        expect(onSessionChange).toHaveBeenCalledOnce()
    })

    it('does not retry when Session persistence fails after a response', async () => {
        const session = createSession(() => {
            throw new Error('storage unavailable')
        })
        const fake = createFakeFetch([
            textResponse('', {
                headers: { 'set-cookie': 'new_cookie=value; Path=/' }
            })
        ])

        await expect(
            createTransport(fake.fetch, { session }).request(READ_ENDPOINT)
        ).rejects.toMatchObject({ code: 'QZONE_REQUEST' })
        expect(fake.calls).toHaveLength(1)
        expect(session.export().cookies.new_cookie).toBe('value')
    })

    it('follows relative and absolute QQ redirects', async () => {
        const fake = createFakeFetch([
            textResponse('', { status: 302, headers: { location: '/next' } }),
            textResponse('', {
                status: 302,
                headers: { location: 'https://mobile.qzone.qq.com/final' }
            }),
            jsonResponse({ ok: true })
        ])
        const transport = createTransport(fake.fetch)

        expect(await transport.requestData(READ_ENDPOINT)).toEqual({ ok: true })
        expect(fake.calls.map((call) => call.url)).toEqual([
            expect.stringContaining('https://h5.qzone.qq.com/feed'),
            expect.stringContaining('https://h5.qzone.qq.com/next'),
            expect.stringContaining('https://mobile.qzone.qq.com/final')
        ])
        expect(fake.calls[1]?.url).toContain('g_tk=')
        expect(fake.calls[2]?.url).toContain('qzonetoken=token')
    })

    it.each([
        ['https://example.com/', QzoneRequestError],
        ['javascript:alert(1)', QzoneRequestError],
        ['http://mobile.qzone.qq.com/insecure', QzoneRequestError],
        ['https://ptlogin2.qq.com/login', QzoneAuthError],
        ['https://user.qzone.qq.com/10001', QzoneRequestError]
    ])('rejects unsafe redirect %s', async (location, ErrorType) => {
        const fake = createFakeFetch([
            textResponse('', { status: 302, headers: { location } })
        ])

        await expect(
            createTransport(fake.fetch).request(READ_ENDPOINT)
        ).rejects.toBeInstanceOf(ErrorType)
    })

    it.each([
        [401, QzoneAuthError],
        [403, QzonePermissionError],
        [429, QzoneRateLimitError],
        [404, QzoneRequestError]
    ])('maps HTTP %s errors without retry', async (status, ErrorType) => {
        const fake = createFakeFetch([textResponse('failed', { status })])

        await expect(
            createTransport(fake.fetch).request(READ_ENDPOINT)
        ).rejects.toBeInstanceOf(ErrorType)
        expect(fake.calls).toHaveLength(1)
    })

    it('retries read network and server failures with bounded attempts', async () => {
        const fake = createFakeFetch([
            () => Promise.reject(new TypeError('network')),
            textResponse('failed', { status: 503 }),
            jsonResponse({ ok: true })
        ])

        expect(
            await createTransport(fake.fetch).requestData(READ_ENDPOINT)
        ).toEqual({
            ok: true
        })
        expect(fake.calls).toHaveLength(3)
    })

    it('maps an exhausted server failure after bounded retries', async () => {
        const fake = createFakeFetch([
            textResponse('failed', { status: 503 }),
            textResponse('failed', { status: 503 }),
            textResponse('failed', { status: 503 })
        ])

        await expect(
            createTransport(fake.fetch).request(READ_ENDPOINT)
        ).rejects.toMatchObject({
            code: 'QZONE_REQUEST',
            context: { statusCode: 503 }
        })
        expect(fake.calls).toHaveLength(3)
    })

    it('does not retry writes when the network result is unknown', async () => {
        const fake = createFakeFetch([
            () => Promise.reject(new TypeError('network'))
        ])

        await expect(
            createTransport(fake.fetch).request(WRITE_ENDPOINT)
        ).rejects.toBeInstanceOf(UncertainTransportError)
        expect(fake.calls).toHaveLength(1)
    })

    it('rejects form bodies on GET endpoints before sending', async () => {
        const fake = createFakeFetch([])

        await expect(
            createTransport(fake.fetch).request(READ_ENDPOINT, {
                form: { invalid: true }
            })
        ).rejects.toMatchObject({ code: 'QZONE_VALIDATION' })
        expect(fake.calls).toHaveLength(0)
    })

    it('distinguishes caller cancellation before and after sending', async () => {
        const before = new AbortController()
        before.abort()
        const unused = createFakeFetch([])
        await expect(
            createTransport(unused.fetch).request(READ_ENDPOINT, {
                signal: before.signal
            })
        ).rejects.toBeInstanceOf(QzoneCancelledError)
        expect(unused.calls).toHaveLength(0)

        const after = new AbortController()
        const fake = createFakeFetch([
            () => new Promise<Response>(() => undefined)
        ])
        const pending = createTransport(fake.fetch).request(READ_ENDPOINT, {
            signal: after.signal
        })
        after.abort()

        await expect(pending).rejects.toBeInstanceOf(QzoneCancelledError)
        expect(fake.calls).toHaveLength(1)
    })

    it('does not send a redirect after cancellation during cookie persistence', async () => {
        const controller = new AbortController()
        const session = createSession(() => controller.abort())
        const fake = createFakeFetch([
            textResponse('', {
                status: 302,
                headers: {
                    location: '/next',
                    'set-cookie': 'new_cookie=value; Path=/'
                }
            })
        ])

        await expect(
            createTransport(fake.fetch, { session }).request(READ_ENDPOINT, {
                signal: controller.signal
            })
        ).rejects.toBeInstanceOf(QzoneCancelledError)
        expect(fake.calls).toHaveLength(1)
    })

    it('aborts a stalled request at the configured timeout', async () => {
        const fake = createFakeFetch([
            () => new Promise<Response>(() => undefined),
            () => new Promise<Response>(() => undefined),
            () => new Promise<Response>(() => undefined)
        ])

        await expect(
            createTransport(fake.fetch, { timeoutMs: 5 }).request(READ_ENDPOINT)
        ).rejects.toThrow('QQ 空间请求超时')
        expect(fake.calls).toHaveLength(3)
    })

    it('applies the request timeout while reading the response body', async () => {
        const fake = createFakeFetch([
            stalledResponse(),
            stalledResponse(),
            stalledResponse()
        ])

        await expect(
            createTransport(fake.fetch, { timeoutMs: 5 }).request(READ_ENDPOINT)
        ).rejects.toThrow('QQ 空间请求超时')
        expect(fake.calls).toHaveLength(3)
    })

    it('does not expose credentials or request data to logger events', async () => {
        const events: unknown[] = []
        const fake = createFakeFetch([jsonResponse({ ok: true })])
        const transport = createTransport(fake.fetch, {
            logger: (event) => events.push(event)
        })

        await transport.request(READ_ENDPOINT, {
            query: { secret: 'query-value' },
            headers: { 'x-private': 'header-value' }
        })

        const serialized = JSON.stringify(events)
        expect(serialized).not.toContain('secret')
        expect(serialized).not.toContain('query-value')
        expect(serialized).not.toContain('header-value')
        expect(serialized).not.toContain('p_skey')
    })

    it('emits only whitelisted fields for retries and failures', async () => {
        const events: Record<string, unknown>[] = []
        const fake = createFakeFetch([
            textResponse('private-response-value', { status: 503 }),
            textResponse('private-response-value', { status: 403 })
        ])
        const transport = createTransport(fake.fetch, {
            logger: (event) => events.push({ ...event })
        })

        await expect(
            transport.request(READ_ENDPOINT, {
                query: { secret: 'query-value' },
                headers: { 'x-private': 'header-value' }
            })
        ).rejects.toBeInstanceOf(QzonePermissionError)

        const allowed = new Set([
            'level',
            'phase',
            'endpoint',
            'fallbackEndpoint',
            'durationMs',
            'retryCount',
            'statusCode',
            'errorCode'
        ])
        for (const event of events) {
            expect(Object.keys(event).every((key) => allowed.has(key))).toBe(
                true
            )
        }
        expect(events).toContainEqual(
            expect.objectContaining({
                phase: 'request.retry',
                endpoint: 'feed.list',
                retryCount: 1,
                statusCode: 503
            })
        )
        expect(events.at(-1)).toMatchObject({
            level: 'error',
            phase: 'request.error',
            endpoint: 'feed.list',
            retryCount: 1,
            statusCode: 403,
            errorCode: 'QZONE_PERMISSION'
        })
        const serialized = JSON.stringify(events)
        expect(serialized).not.toContain('private-response-value')
        expect(serialized).not.toContain('query-value')
        expect(serialized).not.toContain('header-value')
        expect(serialized).not.toContain('p_skey')
        expect(serialized).not.toContain('token')
    })

    it('lets a caller defer the log for a normalized request failure', async () => {
        const events: Record<string, unknown>[] = []
        let handledFailure: unknown
        const fake = createFakeFetch([
            textResponse('private-response-value', { status: 403 })
        ])
        const transport = createTransport(fake.fetch, {
            logger: (event) => events.push({ ...event })
        })

        await expect(
            transport.request(READ_ENDPOINT, {
                failureLogDisposition: (error) => {
                    handledFailure = error
                    return 'handled-fallback'
                }
            })
        ).rejects.toBeInstanceOf(QzonePermissionError)

        expect(handledFailure).toBeInstanceOf(QzonePermissionError)
        expect(events.some((event) => event.phase === 'request.error')).toBe(
            false
        )
    })
})

function createSession(onSessionChange?: () => void): SessionState {
    return new SessionState(
        {
            cookies: 'uin=o10001; p_skey=secret',
            tokens: { '10001': 'token' }
        },
        { onSessionChange }
    )
}

function stalledResponse(): Response {
    return new Response(
        new ReadableStream<Uint8Array>({
            start(): void {
                // Keep the stream open without producing a body.
            }
        })
    )
}

function createTransport(
    fetch: typeof globalThis.fetch,
    options: {
        readonly session?: SessionState
        readonly logger?: QzoneLogger
        readonly timeoutMs?: number
        readonly userAgent?: string
    } = {}
): FetchTransport {
    return new FetchTransport({
        session: options.session ?? createSession(),
        fetch,
        logger: options.logger,
        userAgent: options.userAgent,
        timeoutMs: options.timeoutMs ?? 1_000,
        retryDelayMs: () => 0
    })
}
