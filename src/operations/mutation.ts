import { QzoneValidationError } from '../errors.js'
import type { MutationReceipt } from '../protocol/mutation.js'
import type { ProtocolPost } from '../protocol/types.js'
import { toPublicPost } from '../protocol/types.js'
import type { SessionState } from '../session/session.js'
import type {
    CommentMutationResult,
    CommentOptions,
    CommentReference,
    DeleteOwnPostOptions,
    LikeMutationResult,
    LikeOptions,
    MutationOutcome,
    PostMutationResult,
    PostTarget,
    QzoneComment,
    QzonePost,
    ReplyOptions,
    UnlikeOptions
} from '../types.js'
import { UncertainTransportError } from '../transport/fetch-transport.js'
import { FeedOperations } from './feed.js'
import { PostOperations } from './post.js'
import {
    resolveMutationPost,
    type MutationReferenceContext
} from './references.js'
import { verifyComment, verifyDeleted, verifyPost } from './verification.js'
import { QzoneWriteApi } from './write.js'

export class MutationOperations {
    readonly #session: SessionState
    readonly #write: QzoneWriteApi
    readonly #posts: PostOperations
    readonly #references: MutationReferenceContext

    constructor(
        session: SessionState,
        write: QzoneWriteApi,
        posts: PostOperations,
        feeds: FeedOperations
    ) {
        this.#session = session
        this.#write = write
        this.#posts = posts
        this.#references = Object.freeze({ session, posts, feeds })
    }

    async comment(options: CommentOptions): Promise<CommentMutationResult> {
        const { post, content, signal } = normalizeCommentOptions(options)
        const target = await resolveMutationPost(this.#references, post, signal)
        return this.#writeComment(target, post, content, null, signal)
    }

    async reply(options: ReplyOptions): Promise<CommentMutationResult> {
        const { post, content, comment, signal } =
            normalizeReplyOptions(options)
        const cached = this.#posts.getCachedPost(post)
        let target =
            cached ??
            (await resolveMutationPost(this.#references, post, signal))
        const existing = target.comments.find((item) => item.id === comment.id)
        if (existing && existing.author.id !== comment.authorId) {
            throw new QzoneValidationError('目标评论作者与评论引用不一致')
        }
        if (!existing && cached) {
            target = await resolveMutationPost(
                this.#references,
                post,
                signal,
                true
            )
            const refreshed = target.comments.find(
                (item) => item.id === comment.id
            )
            if (refreshed && refreshed.author.id !== comment.authorId) {
                throw new QzoneValidationError('目标评论作者与评论引用不一致')
            }
        }
        return this.#writeComment(target, post, content, comment, signal)
    }

    like(options: LikeOptions): Promise<LikeMutationResult> {
        return this.#setLike(options, true)
    }

    unlike(options: UnlikeOptions): Promise<LikeMutationResult> {
        return this.#setLike(options, false)
    }

    async deleteOwnPost(
        options: DeleteOwnPostOptions
    ): Promise<PostMutationResult> {
        const { post, signal } = normalizePostOptions(options)
        const accountId = this.#session.accountId
        if (!accountId) {
            throw new QzoneValidationError('当前 Session 缺少账号')
        }

        let target = this.#posts.getCachedPost(post)
        if (post.authorId.trim() !== accountId) {
            throw new QzoneValidationError('只能删除当前账号发布的动态')
        }
        if (target && target.authorId !== accountId) {
            throw new QzoneValidationError('只能删除当前账号发布的动态')
        }
        if (!target || !target.createdAt) {
            target = await resolveMutationPost(
                this.#references,
                post,
                signal,
                true
            )
        }
        if (target.authorId !== accountId) {
            throw new QzoneValidationError('只能删除当前账号发布的动态')
        }
        const createdAt = target.createdAt
            ? Math.floor(Date.parse(target.createdAt) / 1_000)
            : Number.NaN
        if (!Number.isSafeInteger(createdAt) || createdAt <= 0) {
            throw new QzoneValidationError('无法确认动态真实创建时间，拒绝删除')
        }

        let fallback: 'accepted' | 'unknown' = 'accepted'
        let receipt: MutationReceipt | undefined
        try {
            receipt = await this.#write.deletePost(target, createdAt, signal)
        } catch (error) {
            if (!(error instanceof UncertainTransportError)) {
                throw error
            }
            fallback = 'unknown'
        }

        if (await verifyDeleted(this.#posts, post)) {
            this.#posts.deleteCachedPost(post)
            return postMutationResult(
                'verified',
                receipt?.message,
                postReference(target)
            )
        }
        return postMutationResult(
            fallback,
            receipt?.message,
            postReference(target)
        )
    }

    async #writeComment(
        target: ProtocolPost,
        post: PostTarget,
        content: string,
        replyTo: CommentReference | null,
        signal?: AbortSignal
    ): Promise<CommentMutationResult> {
        const sentAt = Date.now()
        let fallback: 'accepted' | 'unknown' = 'accepted'
        let receipt: MutationReceipt | undefined
        try {
            receipt = await this.#write.comment(
                target,
                content,
                replyTo ?? undefined,
                signal
            )
        } catch (error) {
            if (!(error instanceof UncertainTransportError)) {
                throw error
            }
            fallback = 'unknown'
        }

        const comment = await verifyComment(
            this.#session,
            this.#posts,
            post,
            content,
            replyTo,
            receipt?.id ?? null,
            sentAt
        )
        if (comment) {
            return commentMutationResult('verified', receipt?.message, comment)
        }
        return commentMutationResult(
            fallback,
            receipt?.message,
            undefined,
            receipt?.id
                ? { id: receipt.id, authorId: this.#session.accountId ?? '' }
                : undefined
        )
    }

    async #setLike(
        options: LikeOptions | UnlikeOptions,
        liked: boolean
    ): Promise<LikeMutationResult> {
        const { post, signal } = normalizePostOptions(options)
        const current = await resolveMutationPost(
            this.#references,
            post,
            signal,
            true
        )
        if (current.liked === liked) {
            return likeMutationResult(
                'already-applied',
                liked,
                undefined,
                toPublicPost(current)
            )
        }

        let fallback: 'accepted' | 'unknown' = 'accepted'
        let receipt: MutationReceipt | undefined
        try {
            receipt = await this.#write.setLike(current, liked, signal)
        } catch (error) {
            if (!(error instanceof UncertainTransportError)) {
                throw error
            }
            fallback = 'unknown'
        }

        const verified = await verifyPost(
            this.#posts,
            post,
            (value) => value.liked === liked
        )
        return verified
            ? likeMutationResult('verified', liked, receipt?.message, verified)
            : likeMutationResult(fallback, liked, receipt?.message)
    }
}

function normalizeCommentOptions(options: CommentOptions): {
    readonly post: PostTarget
    readonly content: string
    readonly signal?: AbortSignal
} {
    const normalized = normalizePostOptions(options)
    const content = normalizeContent(options.content, '评论')
    return { ...normalized, content }
}

function normalizeReplyOptions(options: ReplyOptions): {
    readonly post: PostTarget
    readonly comment: CommentReference
    readonly content: string
    readonly signal?: AbortSignal
} {
    const normalized = normalizePostOptions(options)
    const comment = normalizeCommentReference(options.comment)
    const content = normalizeContent(options.content, '回复')
    return { ...normalized, comment, content }
}

function normalizePostOptions(options: {
    readonly post: PostTarget
    readonly signal?: AbortSignal
}): { readonly post: PostTarget; readonly signal?: AbortSignal } {
    if (!options || typeof options !== 'object') {
        throw new QzoneValidationError('操作参数必须是对象')
    }
    return {
        post: options.post,
        ...(options.signal ? { signal: options.signal } : {})
    }
}

function normalizeCommentReference(
    value: ReplyOptions['comment']
): CommentReference {
    if (!value || typeof value !== 'object') {
        throw new QzoneValidationError('评论引用不能为空')
    }
    const id = typeof value.id === 'string' ? value.id.trim() : ''
    const authorId =
        'author' in value
            ? value.author?.id
            : typeof value.authorId === 'string'
              ? value.authorId
              : ''
    if (!id) {
        throw new QzoneValidationError('评论 ID 不能为空')
    }
    if (typeof authorId !== 'string' || !/^\d+$/u.test(authorId.trim())) {
        throw new QzoneValidationError('评论作者账号必须是十进制数字字符串')
    }
    return Object.freeze({ id, authorId: authorId.trim() })
}

function normalizeContent(value: unknown, label: string): string {
    if (typeof value !== 'string' || !value.trim()) {
        throw new QzoneValidationError(`${label}内容不能为空`)
    }
    return value
}

function commentMutationResult(
    outcome: MutationOutcome,
    message?: string,
    comment?: QzoneComment,
    reference?: CommentReference
): CommentMutationResult {
    return Object.freeze({
        outcome,
        ...(message ? { message } : {}),
        ...(comment ? { comment } : {}),
        ...(reference ? { reference } : {})
    })
}

function likeMutationResult(
    outcome: MutationOutcome,
    liked: boolean,
    message?: string,
    post?: QzonePost
): LikeMutationResult {
    return Object.freeze({
        outcome,
        liked,
        ...(message ? { message } : {}),
        ...(post ? { post } : {})
    })
}

function postMutationResult(
    outcome: MutationOutcome,
    message: string | undefined,
    reference: { readonly id: string; readonly authorId: string }
): PostMutationResult {
    return Object.freeze({
        outcome,
        ...(message ? { message } : {}),
        reference
    })
}

function postReference(post: ProtocolPost): {
    readonly id: string
    readonly authorId: string
} {
    return Object.freeze({ id: post.id, authorId: post.authorId })
}
