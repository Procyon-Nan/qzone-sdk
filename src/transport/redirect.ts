import { QzoneRequestError } from '../errors.js'
import { isAllowedHttpHost, isQqHttpUrl } from './url-policy.js'

const MAX_REDIRECTS = 3
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

export function isRedirectStatus(status: number): boolean {
    return REDIRECT_STATUSES.has(status)
}

export function resolveRedirect(
    current: URL,
    location: string | null,
    endpoint: string
): URL {
    if (!location) {
        throw new QzoneRequestError('QQ 空间重定向缺少 Location', {
            context: { endpoint }
        })
    }
    try {
        return new URL(location, current)
    } catch (cause) {
        throw new QzoneRequestError('QQ 空间重定向地址无效', {
            cause,
            context: { endpoint }
        })
    }
}

export function isLoginRedirect(url: URL): boolean {
    return url.hostname.toLowerCase().includes('ptlogin')
}

export function isHomeRedirect(url: URL, accountId: string | null): boolean {
    if (url.hostname !== 'user.qzone.qq.com') {
        return false
    }
    const path = url.pathname.replace(/\/+$/u, '')
    return path === '' || (accountId !== null && path === `/${accountId}`)
}

export function isAllowedRedirect(
    current: URL,
    target: URL,
    redirects: number
): boolean {
    return !(
        !isQqHttpUrl(target) ||
        target.username ||
        target.password ||
        (current.protocol === 'https:' && target.protocol !== 'https:') ||
        (target.protocol === 'http:' && !isAllowedHttpHost(target.hostname)) ||
        redirects >= MAX_REDIRECTS
    )
}

export function preserveQuery(target: URL, source: URLSearchParams): void {
    for (const [key, value] of source) {
        if (!target.searchParams.has(key)) {
            target.searchParams.append(key, value)
        }
    }
}
