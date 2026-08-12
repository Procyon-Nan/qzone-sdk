import { QzoneValidationError } from '../errors.js'
import { SessionState } from '../session/session.js'
import type {
    TransportEndpoint,
    TransportParameter,
    TransportRequestOptions
} from './types.js'
import { isAllowedHttpHost, isQqHttpUrl } from './url-policy.js'

export const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) ' +
    'Chrome/122.0.0.0 Safari/537.36'

export function buildUrl(
    endpoint: TransportEndpoint,
    query: TransportRequestOptions['query'],
    session: SessionState
): URL {
    const url = new URL(endpoint.url)
    appendParameters(url.searchParams, query)
    if (endpoint.includeGtk && !url.searchParams.has('g_tk')) {
        url.searchParams.set('g_tk', String(session.gtk))
    }
    if (endpoint.tokenAccountId && !url.searchParams.has('qzonetoken')) {
        url.searchParams.set(
            'qzonetoken',
            session.getToken(endpoint.tokenAccountId) ?? ''
        )
    }
    return url
}

export function buildHeaders(
    endpoint: TransportEndpoint,
    options: TransportRequestOptions,
    session: SessionState,
    userAgent: string
): Headers {
    const headers = new Headers(options.headers)
    headers.set('user-agent', userAgent)
    if (session.cookieHeader) {
        headers.set('cookie', session.cookieHeader)
    }
    if (endpoint.referer) {
        headers.set('referer', endpoint.referer)
    }
    if (endpoint.origin) {
        headers.set('origin', endpoint.origin)
    }
    return headers
}

export function encodeParameters(
    parameters: NonNullable<TransportRequestOptions['form']>
): URLSearchParams {
    const encoded = new URLSearchParams()
    appendParameters(encoded, parameters)
    return encoded
}

export function validateRequest(
    endpoint: TransportEndpoint,
    options: TransportRequestOptions
): void {
    if (!endpoint.id.trim()) {
        throw new QzoneValidationError('Transport endpoint ID 不能为空')
    }
    if (endpoint.method === 'GET' && options.form) {
        throw new QzoneValidationError('GET endpoint 不能包含 form 请求体')
    }

    let url: URL
    try {
        url = new URL(endpoint.url)
    } catch (cause) {
        throw new QzoneValidationError('Transport endpoint URL 无效', { cause })
    }
    if (
        !isQqHttpUrl(url) ||
        url.username ||
        url.password ||
        (url.protocol === 'http:' && !isAllowedHttpHost(url.hostname))
    ) {
        throw new QzoneValidationError(
            'Transport endpoint 必须使用 QQ HTTP(S) 域名'
        )
    }
}

export function positiveInteger(value: number, label: string): number {
    if (!Number.isInteger(value) || value <= 0) {
        throw new QzoneValidationError(`${label}必须是正整数`)
    }
    return value
}

function appendParameters(
    target: URLSearchParams,
    parameters:
        | Readonly<
              Record<string, TransportParameter | readonly TransportParameter[]>
          >
        | undefined
): void {
    for (const [key, rawValue] of Object.entries(parameters ?? {})) {
        const values = Array.isArray(rawValue) ? rawValue : [rawValue]
        for (const value of values) {
            if (value !== null && value !== undefined) {
                target.append(key, String(value))
            }
        }
    }
}
