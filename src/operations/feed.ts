import { QzoneValidationError } from '../errors.js'
import {
    FeedCursorStore,
    type FeedCursorContext,
    type FeedCursorPosition
} from '../internal/cursor.js'
import type { ProtocolFeedPage, ProtocolPost } from '../protocol/types.js'
import { toPublicPost } from '../protocol/types.js'
import type { SessionState } from '../session/session.js'
import type { FeedPage, FeedScope, ListFeedsOptions } from '../types.js'
import { PostCache, postIdentity } from './post-cache.js'
import { QzoneReadApi, shouldFallbackRead } from './read.js'

const DEFAULT_FEED_LIMIT = 10
const MAX_FEED_LIMIT = 20
const MAX_PAGE_ROUNDS = 6

type FeedSource =
    'modern-active' | 'modern-profile' | 'legacy-feeds' | 'legacy-recent'

interface BackendPosition {
    readonly source: FeedSource
    readonly backendCursor: string
    readonly page: number
    readonly beginTime: number
    readonly pageSize: number
}

interface FeedState {
    readonly position: BackendPosition
    readonly hasBackendMore: boolean
    readonly pending: readonly ProtocolPost[]
    readonly seenItems: ReadonlySet<string>
    readonly visitedPages: ReadonlySet<string>
}

interface FeedRequestContext extends FeedCursorContext {
    readonly signal?: AbortSignal
}

interface FetchedPage {
    readonly page: ProtocolFeedPage
    readonly position: BackendPosition
}

export class FeedOperations {
    readonly #session: SessionState
    readonly #read: QzoneReadApi
    readonly #cache: PostCache
    readonly #cursors = new FeedCursorStore<FeedState>()

    constructor(session: SessionState, read: QzoneReadApi, cache: PostCache) {
        this.#session = session
        this.#read = read
        this.#cache = cache
    }

    async listFeeds(options: ListFeedsOptions): Promise<FeedPage> {
        const limit = normalizeLimit(options.limit)
        const context = this.#feedContext(options)
        const cursorContext = toCursorContext(context)
        const state = options.cursor
            ? this.#cursors.read(options.cursor, cursorContext)
            : initialFeedState(options.scope, limit)
        const collected: ProtocolPost[] = []
        const pending = [...state.pending]
        const seenItems = new Set(state.seenItems)
        const visitedPages = new Set(state.visitedPages)
        let position = state.position
        let hasBackendMore = state.hasBackendMore

        while (pending.length > 0 && collected.length < limit) {
            const post = pending.shift()
            if (post) {
                collected.push(post)
            }
        }

        for (
            let round = 0;
            collected.length < limit &&
            hasBackendMore &&
            round < MAX_PAGE_ROUNDS;
            round += 1
        ) {
            const requestedPageKey = pageKey(position)
            if (visitedPages.has(requestedPageKey)) {
                hasBackendMore = false
                break
            }

            const fetched = await this.#fetchPage(position, context)
            position = fetched.position
            const actualPageKey = pageKey(position)
            if (
                actualPageKey !== requestedPageKey &&
                visitedPages.has(actualPageKey)
            ) {
                hasBackendMore = false
                break
            }
            visitedPages.add(requestedPageKey)
            visitedPages.add(actualPageKey)

            const unique = fetched.page.items.filter((post) => {
                const identity = postIdentity(post)
                if (seenItems.has(identity)) {
                    return false
                }
                seenItems.add(identity)
                this.#cache.set(post)
                return true
            })
            const nextPosition = nextBackendPosition(position, fetched.page)
            hasBackendMore = nextPosition !== null
            if (nextPosition) {
                if (visitedPages.has(pageKey(nextPosition))) {
                    hasBackendMore = false
                } else {
                    position = nextPosition
                }
            }

            const available = limit - collected.length
            collected.push(...unique.slice(0, available))
            pending.push(...unique.slice(available))
            if (fetched.page.items.length > 0 && unique.length === 0) {
                hasBackendMore = false
            }
            if (position.source === 'legacy-recent') {
                break
            }
        }

        const continuation: FeedState = {
            position,
            hasBackendMore,
            pending: Object.freeze(pending),
            seenItems,
            visitedPages
        }
        const nextCursor =
            pending.length > 0 || hasBackendMore
                ? this.#cursors.create(
                      cursorContext,
                      toCursorPosition(position),
                      continuation
                  )
                : null
        return Object.freeze({
            items: Object.freeze(collected.map(toPublicPost)),
            nextCursor
        })
    }

    clear(): void {
        this.#cursors.clear()
    }

    #feedContext(options: ListFeedsOptions): FeedRequestContext {
        const accountId = this.#session.accountId
        if (!accountId) {
            throw new QzoneValidationError('当前 Session 缺少账号')
        }
        if (!['self', 'profile', 'friends'].includes(options.scope)) {
            throw new QzoneValidationError('动态列表 scope 无效')
        }
        if (options.scope === 'profile') {
            return {
                accountId,
                scope: options.scope,
                targetId: normalizeAccountId(options.userId, '目标账号'),
                signal: options.signal
            }
        }
        if ((options as { readonly userId?: unknown }).userId !== undefined) {
            throw new QzoneValidationError(
                `${options.scope} scope 不能提供 userId`
            )
        }
        return {
            accountId,
            scope: options.scope,
            targetId: accountId,
            signal: options.signal
        }
    }

    async #fetchPage(
        position: BackendPosition,
        context: FeedRequestContext
    ): Promise<FetchedPage> {
        if (
            position.backendCursor ||
            position.page > 1 ||
            position.beginTime > 0
        ) {
            return {
                page: await this.#fetchPosition(position, context),
                position
            }
        }

        try {
            return {
                page: await this.#fetchPosition(position, context),
                position
            }
        } catch (error) {
            if (!shouldFallbackRead(error)) {
                throw error
            }
            return this.#fetchInitialFallback(context, position.pageSize)
        }
    }

    async #fetchInitialFallback(
        context: FeedRequestContext,
        pageSize: number
    ): Promise<FetchedPage> {
        if (context.scope === 'friends') {
            const position = legacyPosition('legacy-recent', pageSize)
            return {
                page: await this.#fetchPosition(position, context),
                position
            }
        }

        const position = legacyPosition('legacy-feeds', pageSize)
        try {
            return {
                page: await this.#fetchPosition(position, context),
                position
            }
        } catch (error) {
            if (context.scope !== 'self' || !shouldFallbackRead(error)) {
                throw error
            }
            const recent = legacyPosition('legacy-recent', pageSize)
            return {
                page: await this.#fetchPosition(recent, context),
                position: recent
            }
        }
    }

    #fetchPosition(
        position: BackendPosition,
        context: FeedRequestContext
    ): Promise<ProtocolFeedPage> {
        switch (position.source) {
            case 'modern-active':
                return position.backendCursor
                    ? this.#read.active(
                          context.accountId,
                          position.backendCursor,
                          context.signal
                      )
                    : this.#read.index(context.accountId, context.signal)
            case 'modern-profile':
                return position.backendCursor
                    ? this.#read.profileMore(
                          context.targetId,
                          position.backendCursor,
                          context.signal
                      )
                    : this.#profile(context)
            case 'legacy-feeds':
                return this.#read.legacyFeeds(
                    context.targetId,
                    position,
                    context.signal
                )
            case 'legacy-recent':
                return this.#read.recentFeeds(
                    context.accountId,
                    position,
                    context.signal
                )
        }
    }

    async #profile(context: FeedRequestContext): Promise<ProtocolFeedPage> {
        const page = await this.#read.profile(context.targetId, context.signal)
        this.#cache.setPage(page)
        return page
    }
}

function initialFeedState(scope: FeedScope, pageSize: number): FeedState {
    return {
        position: {
            source: scope === 'profile' ? 'modern-profile' : 'modern-active',
            backendCursor: '',
            page: 1,
            beginTime: 0,
            pageSize
        },
        hasBackendMore: true,
        pending: [],
        seenItems: new Set(),
        visitedPages: new Set()
    }
}

function legacyPosition(
    source: 'legacy-feeds' | 'legacy-recent',
    pageSize: number
): BackendPosition {
    return { source, backendCursor: '', page: 1, beginTime: 0, pageSize }
}

function nextBackendPosition(
    position: BackendPosition,
    page: ProtocolFeedPage
): BackendPosition | null {
    if (
        position.source === 'modern-active' ||
        position.source === 'modern-profile'
    ) {
        if (
            !page.hasMore ||
            !page.cursor ||
            page.cursor === position.backendCursor
        ) {
            return null
        }
        return { ...position, backendCursor: page.cursor }
    }
    if (position.source === 'legacy-feeds') {
        const hasMore =
            page.items.length > 0 &&
            (page.hasMore || page.items.length >= position.pageSize)
        return hasMore ? { ...position, page: position.page + 1 } : null
    }

    const timestamps = page.items.flatMap((post) => {
        const timestamp = post.createdAt ? Date.parse(post.createdAt) : 0
        return timestamp > 0 ? [Math.floor(timestamp / 1_000)] : []
    })
    if (page.items.length === 0 || timestamps.length === 0) {
        return null
    }
    const beginTime = Math.min(...timestamps)
    return beginTime === position.beginTime
        ? null
        : { ...position, page: position.page + 1, beginTime }
}

function normalizeLimit(value: number | undefined): number {
    const limit = value ?? DEFAULT_FEED_LIMIT
    if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FEED_LIMIT) {
        throw new QzoneValidationError(
            `动态列表 limit 必须是 1 到 ${MAX_FEED_LIMIT} 的整数`
        )
    }
    return limit
}

function normalizeAccountId(value: unknown, label: string): string {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!/^\d+$/u.test(normalized)) {
        throw new QzoneValidationError(`${label}必须是十进制数字字符串`)
    }
    return normalized
}

function pageKey(position: BackendPosition): string {
    return [
        position.source,
        position.backendCursor,
        position.page,
        position.beginTime,
        position.pageSize
    ].join('\u0000')
}

function toCursorPosition(position: BackendPosition): FeedCursorPosition {
    return { ...position }
}

function toCursorContext(context: FeedRequestContext): FeedCursorContext {
    return {
        accountId: context.accountId,
        scope: context.scope,
        targetId: context.targetId
    }
}
