import {
    QzoneNotFoundError,
    QzoneParseError,
    QzoneRequestError,
    QzoneValidationError
} from '../errors.js'
import {
    findPostDetail,
    mergeProtocolPost,
    parseProtocolPost
} from '../protocol/post.js'
import type { ProtocolPost } from '../protocol/types.js'
import { toPublicPost } from '../protocol/types.js'
import type {
    GetPostOptions,
    PostTarget,
    QzoneId,
    QzonePost
} from '../types.js'
import { PostCache } from './post-cache.js'
import { QzoneReadApi, shouldFallbackRead } from './read.js'

export class PostOperations {
    readonly #read: QzoneReadApi
    readonly #cache: PostCache

    constructor(read: QzoneReadApi, cache: PostCache) {
        this.#read = read
        this.#cache = cache
    }

    async getPost(options: GetPostOptions): Promise<QzonePost> {
        return toPublicPost(
            await this.resolvePost(options.post, options.signal, true)
        )
    }

    getCachedPost(post: PostTarget): ProtocolPost | undefined {
        const target = normalizePostTarget(post)
        return this.#cache.get(target.authorId, target.id)
    }

    async resolvePost(
        post: PostTarget,
        signal?: AbortSignal,
        refresh = false
    ): Promise<ProtocolPost> {
        const target = normalizePostTarget(post)
        const cached = this.#cache.get(target.authorId, target.id)
        if (cached && !refresh) {
            return cached
        }
        const base = cached ?? protocolPostFromTarget(post, target)
        let record

        if (base.action.appId === 311) {
            try {
                record = await this.#legacyDetail(target, signal)
            } catch (error) {
                if (!shouldFallbackRead(error)) {
                    throw error
                }
                this.#read.logReadFallback(
                    'post.detail.legacy',
                    'post.detail.h5',
                    error
                )
                record = await this.#h5Detail(base, target, signal)
            }
        } else {
            record = await this.#h5Detail(base, target, signal)
        }

        const merged = mergeProtocolPost(base, record)
        this.#cache.set(merged)
        return merged
    }

    deleteCachedPost(post: PostTarget): void {
        const target = normalizePostTarget(post)
        this.#cache.delete(target.authorId, target.id)
    }

    async #legacyDetail(
        target: { readonly id: QzoneId; readonly authorId: QzoneId },
        signal?: AbortSignal
    ): Promise<NonNullable<ReturnType<typeof findPostDetail>>> {
        try {
            const detail = await this.#read.legacyDetail(
                target.authorId,
                target.id,
                {
                    signal,
                    fallback: true
                }
            )
            return requirePostDetail(detail, target)
        } catch (error) {
            throw this.#mapDetailError(error, target)
        }
    }

    async #h5Detail(
        post: ProtocolPost,
        target: { readonly id: QzoneId; readonly authorId: QzoneId },
        signal?: AbortSignal
    ): Promise<NonNullable<ReturnType<typeof findPostDetail>>> {
        const tokenPage = await this.#read.ensureToken(post.authorId, signal)
        if (tokenPage) {
            this.#cache.setPage(tokenPage)
        }
        try {
            const detail = await this.#read.h5Detail(post, signal)
            return requirePostDetail(detail, target)
        } catch (error) {
            throw this.#mapDetailError(error, target)
        }
    }

    #mapDetailError(
        error: unknown,
        target: { readonly id: QzoneId; readonly authorId: QzoneId }
    ): unknown {
        if (!isNotFoundResponse(error)) {
            return error
        }
        this.#cache.delete(target.authorId, target.id)
        const { endpoint, statusCode, serviceCode, retryCount } =
            error.context ?? {}
        return new QzoneNotFoundError('QQ 空间动态不存在', {
            cause: error,
            context: {
                operation: 'post.detail',
                endpoint,
                statusCode,
                serviceCode,
                retryCount
            }
        })
    }
}

function isNotFoundResponse(error: unknown): error is QzoneRequestError {
    return (
        error instanceof QzoneRequestError &&
        (error.context?.statusCode === 404 || error.context?.serviceCode === -8)
    )
}

function normalizePostTarget(post: PostTarget): {
    readonly id: QzoneId
    readonly authorId: QzoneId
} {
    if (!post || typeof post !== 'object') {
        throw new QzoneValidationError('动态引用不能为空')
    }
    const id = typeof post.id === 'string' ? post.id.trim() : ''
    if (!id) {
        throw new QzoneValidationError('动态 ID 不能为空')
    }
    return {
        id,
        authorId: normalizeAccountId(post.authorId, '动态作者账号')
    }
}

function normalizeAccountId(value: unknown, label: string): QzoneId {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (!/^\d+$/u.test(normalized)) {
        throw new QzoneValidationError(`${label}必须是十进制数字字符串`)
    }
    return normalized
}

function protocolPostFromTarget(
    post: PostTarget,
    target: { readonly id: QzoneId; readonly authorId: QzoneId }
): ProtocolPost {
    const base = parseProtocolPost({ fid: target.id, hostuin: target.authorId })
    if (!isPublicPost(post)) {
        return base
    }
    if (post.author.id !== target.authorId) {
        throw new QzoneValidationError('动态作者信息与 authorId 不一致')
    }
    return Object.freeze({
        ...base,
        authorNickname: post.author.nickname,
        ...(post.author.avatarUrl
            ? { authorAvatarUrl: post.author.avatarUrl }
            : {}),
        content: post.content,
        createdAt: post.createdAt,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        liked: post.liked,
        media: Object.freeze([...post.media]),
        comments: Object.freeze([...post.comments]),
        commentsComplete: post.commentsComplete,
        commentSnapshotPresent: true
    })
}

function isPublicPost(post: PostTarget): post is QzonePost {
    return (
        'author' in post &&
        typeof post.author === 'object' &&
        post.author !== null
    )
}

function requirePostDetail(
    value: unknown,
    target: { readonly id: QzoneId; readonly authorId: QzoneId }
): NonNullable<ReturnType<typeof findPostDetail>> {
    const record = findPostDetail(value, target)
    if (!record) {
        throw new QzoneParseError('QQ 空间详情响应缺少目标动态', {
            context: { operation: 'post.detail' }
        })
    }
    return record
}
