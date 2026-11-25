import {
    type QzoneError,
    QzoneAuthError,
    QzoneParseError,
    QzonePermissionError,
    QzoneRateLimitError,
    QzoneRequestError
} from '../errors.js'
import {
    activeFeedsEndpoint,
    videoIndexEndpoint,
    h5DetailEndpoint,
    indexEndpoint,
    legacyDetailEndpoint,
    legacyFeedsEndpoint,
    profileEndpoint,
    profileFeedsEndpoint,
    recentFeedsEndpoint
} from '../protocol/endpoints.js'
import { isVideoPlayer, normalizeRemoteUrl } from '../protocol/media-url.js'
import { parseFeedPage } from '../protocol/feed.js'
import { parseIndexPageHtml, parseProfilePageHtml } from '../protocol/page.js'
import { assertPayloadSuccess } from '../protocol/payload.js'
import type { ProtocolFeedPage, ProtocolPost } from '../protocol/types.js'
import type { SessionState } from '../session/session.js'
import type { QzoneId } from '../types.js'
import type { FetchTransport } from '../transport/fetch-transport.js'
import type { TransportRequestOptions } from '../transport/types.js'

import { asRecord, asRecords, toText } from '../protocol/value.js'

export interface LegacyPagePosition {
    readonly page: number
    readonly beginTime: number
    readonly pageSize: number
}

interface ReadRequestOptions {
    readonly signal?: AbortSignal
    readonly fallback?: true
}

export class QzoneReadApi {
    readonly #session: SessionState
    readonly #transport: FetchTransport

    constructor(session: SessionState, transport: FetchTransport) {
        this.#session = session
        this.#transport = transport
    }

    #assertLegacyPayloadSuccess(payload: unknown, endpoint: string): void {
        try {
            assertPayloadSuccess(payload, endpoint)
        } catch (error) {
            if (
                error instanceof QzoneAuthError &&
                error.context?.serviceCode === -3000 &&
                !this.#session.getCookie('p_skey')
            ) {
                const hint =
                    '当前会话缺少 p_skey，请重新获取包含 p_skey 的 QQ 空间 Cookie。'
                throw new QzoneAuthError(`${error.message}；${hint}`, {
                    cause: error,
                    context: { ...error.context, hint }
                })
            }
            throw error
        }
    }

    async videoUrls(
        author: string,
        ids: readonly string[],
        signal?: AbortSignal
    ) {
        const found = new Map<string, string>()
        const wanted = new Set(ids)
        const endpoint = videoIndexEndpoint(author)
        const count = 50
        const seen = new Set<string>()
        for (let start = 0; found.size < wanted.size; start += count) {
            const payload = await this.#transport.requestData(endpoint, {
                query: {
                    uin: this.#session.accountId,
                    hostUin: author,
                    appid: 4,
                    getMethod: 2,
                    start,
                    count,
                    need_old: 1,
                    getUserInfo: 1,
                    inCharset: 'utf-8',
                    outCharset: 'utf-8',
                    format: 'json'
                },
                signal
            })
            assertPayloadSuccess(payload, endpoint.id)
            const rows = asRecords(asRecord(asRecord(payload)?.data)?.Videos)
            const before = seen.size
            for (const row of rows) {
                const id = toText(row.vid)
                seen.add(id)
                const url = normalizeRemoteUrl(row.url)
                if (wanted.has(id) && url && !isVideoPlayer(url))
                    found.set(id, url)
            }
            if (rows.length < count || seen.size === before) break
        }
        return found
    }

    async index(
        accountId: QzoneId,
        options: ReadRequestOptions = {}
    ): Promise<ProtocolFeedPage> {
        const response = await this.#transport.request(
            indexEndpoint(accountId),
            readTransportOptions(options)
        )
        const page = parseIndexPageHtml(response.text)
        await this.#session.setToken(accountId, page.token)
        return parseFeedPage(page.feed)
    }

    async profile(
        userId: QzoneId,
        options: ReadRequestOptions = {}
    ): Promise<ProtocolFeedPage> {
        const response = await this.#transport.request(
            profileEndpoint(userId),
            {
                query: { hostuin: userId, starttime: 0 },
                ...readTransportOptions(options)
            }
        )
        const page = parseProfilePageHtml(response.text)
        await this.#session.setToken(userId, page.token)
        return parseFeedPage(page.feed, userId)
    }

    async active(
        accountId: QzoneId,
        cursor: string,
        signal?: AbortSignal
    ): Promise<ProtocolFeedPage> {
        const payload = await this.#transport.requestData(
            activeFeedsEndpoint(accountId),
            { query: { attach_info: cursor }, signal }
        )
        assertPayloadSuccess(payload, 'feed.active')
        return parseFeedPage(payload)
    }

    async profileMore(
        userId: QzoneId,
        cursor: string,
        signal?: AbortSignal
    ): Promise<ProtocolFeedPage> {
        const payload = await this.#transport.requestData(
            profileFeedsEndpoint(userId),
            {
                query: {
                    hostuin: userId,
                    res_attach: cursor,
                    res_type: 2,
                    refresh_type: 2,
                    format: 'json'
                },
                signal
            }
        )
        assertPayloadSuccess(payload, 'feed.profile.more')
        return parseFeedPage(payload, userId)
    }

    async legacyFeeds(
        userId: QzoneId,
        position: LegacyPagePosition,
        options: ReadRequestOptions = {}
    ): Promise<ProtocolFeedPage> {
        const payload = await this.#transport.requestData(
            legacyFeedsEndpoint(userId),
            {
                query: {
                    uin: userId,
                    hostUin: userId,
                    pos: (position.page - 1) * position.pageSize,
                    num: position.pageSize,
                    replynum: 100,
                    callback: '_preloadCallback',
                    code_version: 1,
                    format: 'json',
                    need_comment: 1,
                    need_private_comment: 1
                },
                ...readTransportOptions(options)
            }
        )
        this.#assertLegacyPayloadSuccess(payload, 'feed.legacy')
        return parseFeedPage(payload, userId)
    }

    async recentFeeds(
        accountId: QzoneId,
        position: LegacyPagePosition,
        signal?: AbortSignal
    ): Promise<ProtocolFeedPage> {
        const payload = await this.#transport.requestData(
            recentFeedsEndpoint(accountId),
            {
                query: {
                    uin: accountId,
                    scope: 0,
                    view: 1,
                    filter: 'all',
                    flag: 1,
                    applist: 'all',
                    pagenum: position.page,
                    aisortEndTime: 0,
                    aisortOffset: 0,
                    aisortBeginTime: 0,
                    begintime: position.beginTime,
                    format: 'json',
                    useutf8: 1,
                    outputhtmlfeed: 1
                },
                signal
            }
        )
        assertPayloadSuccess(payload, 'feed.recent')
        return parseFeedPage(payload)
    }

    async legacyDetail(
        authorId: QzoneId,
        postId: QzoneId,
        options: ReadRequestOptions = {}
    ): Promise<unknown> {
        const payload = await this.#transport.requestData(
            legacyDetailEndpoint(authorId, postId),
            {
                query: {
                    uin: authorId,
                    tid: postId,
                    num: 20,
                    pos: 0,
                    not_trunc_con: 1,
                    format: 'json'
                },
                ...readTransportOptions(options)
            }
        )
        this.#assertLegacyPayloadSuccess(payload, 'post.detail.legacy')
        return payload
    }

    async h5Detail(post: ProtocolPost, signal?: AbortSignal): Promise<unknown> {
        const payload = await this.#transport.requestData(
            h5DetailEndpoint(post.authorId, post.id, post.action.appId),
            {
                query: {
                    cellid: post.id,
                    uin: post.authorId,
                    appid: post.action.appId,
                    busi_param: serializeBusinessParameters(
                        post.action.businessParameters
                    ),
                    format: 'json',
                    count: 20,
                    refresh_type: 31,
                    subid: ''
                },
                signal
            }
        )
        assertPayloadSuccess(payload, 'post.detail.h5')
        return payload
    }

    async ensureToken(
        userId: QzoneId,
        signal?: AbortSignal
    ): Promise<ProtocolFeedPage | null> {
        if (this.#session.getToken(userId)) {
            return null
        }
        return userId === this.#session.accountId
            ? this.index(userId, { signal })
            : this.profile(userId, { signal })
    }

    logReadFallback(
        endpoint: string,
        fallbackEndpoint: string,
        error: QzoneError
    ): void {
        this.#transport.logReadFallback(endpoint, fallbackEndpoint, error)
    }
}

export function shouldFallbackRead(error: unknown): error is QzoneError {
    if (error instanceof QzoneParseError) {
        return true
    }
    if (
        error instanceof QzonePermissionError ||
        error instanceof QzoneRateLimitError
    ) {
        return true
    }
    if (!(error instanceof QzoneRequestError)) {
        return false
    }
    const status = error.context?.statusCode ?? 0
    return [301, 302, 303, 307, 308].includes(status) || status >= 500
}

function readTransportOptions(
    options: ReadRequestOptions
): Pick<TransportRequestOptions, 'signal' | 'suppressFailureLog'> {
    return {
        signal: options.signal,
        ...(options.fallback ? { suppressFailureLog: shouldFallbackRead } : {})
    }
}

function serializeBusinessParameters(
    value: Readonly<Record<string, unknown>>
): string {
    // 移动端先拼接原始键值对，再将整串作为一个查询参数编码。
    return Object.entries(value)
        .map(([key, item]) => `${key}=${String(item)}`)
        .join('&')
}
