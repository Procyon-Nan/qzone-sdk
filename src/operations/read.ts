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
    h5DetailEndpoint,
    indexEndpoint,
    legacyDetailEndpoint,
    legacyFeedsEndpoint,
    profileEndpoint,
    profileFeedsEndpoint,
    recentFeedsEndpoint
} from '../protocol/endpoints.js'
import { parseFeedPage } from '../protocol/feed.js'
import { parseIndexPageHtml, parseProfilePageHtml } from '../protocol/page.js'
import { assertPayloadSuccess } from '../protocol/payload.js'
import type { ProtocolFeedPage, ProtocolPost } from '../protocol/types.js'
import type { SessionState } from '../session/session.js'
import type { QzoneId } from '../types.js'
import type { FetchTransport } from '../transport/fetch-transport.js'
import type { TransportRequestOptions } from '../transport/types.js'

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

    /**
     * 说说类接口（emotion_cgi_*）只接受 p_skey 派生的 g_tk。仅有 skey 的会话
     * 在这些端点上会得到业务码 -3000，这里把它翻译成可操作的提示。
     */
    #enhanceMoodAuthError(error: unknown): unknown {
        if (
            error instanceof QzoneAuthError
            && this.#session.getCookie('p_skey') === undefined
        ) {
            const context = {
                ...(error.context ?? {}),
                hint: '会话缺少 p_skey Cookie：说说类接口需要 p_skey 派生的 g_tk，仅凭 skey 会被服务端拒绝。请重新完成登录闭环以获取完整 Cookie。'
            }
            return new QzoneAuthError(
                'QQ 空间登录态已失效或缺少 p_skey（说说类接口需要 p_skey 派生的 g_tk）',
                { cause: error, context }
            )
        }
        return error
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
        return parseFeedPage(page.feed, accountId)
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
        let payload
        try {
            payload = await this.#transport.requestData(
                activeFeedsEndpoint(accountId),
                { query: { attach_info: cursor }, signal }
            )
            assertPayloadSuccess(payload, 'feed.active')
        } catch (error) {
            throw this.#enhanceMoodAuthError(error)
        }
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
        let payload
        try {
            payload = await this.#transport.requestData(
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
        } catch (error) {
            throw this.#enhanceMoodAuthError(error)
        }
        try {
            assertPayloadSuccess(payload, 'feed.legacy')
        } catch (error) {
            throw this.#enhanceMoodAuthError(error)
        }
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
        let payload
        try {
            payload = await this.#transport.requestData(
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
            assertPayloadSuccess(payload, 'post.detail.legacy')
        } catch (error) {
            throw this.#enhanceMoodAuthError(error)
        }
        return payload
    }

    async h5Detail(post: ProtocolPost, signal?: AbortSignal): Promise<unknown> {
        const payload = await this.#transport.requestData(
            h5DetailEndpoint(post.authorId, post.id),
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
    return Object.keys(value).length > 0 ? JSON.stringify(value) : ''
}
