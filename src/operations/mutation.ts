import { QzoneValidationError } from '../errors.js'
import { serializeReplyDisplayMarker } from '../protocol/comment.js'
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
    QzoneUser,
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
import { verifyComment, verifyDeleted, verifyLike } from './verification.js'
import { QzoneWriteApi } from './write.js'

interface NormalizedReplyTarget {
    readonly reference: CommentReference
    readonly identity: {
        readonly kind: QzoneComment['kind']
        readonly threadRoot: CommentReference | null
    } | null
}

interface ReplyContext {
    readonly threadRoot: CommentReference
    readonly replyToUser: QzoneUser | null
}

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
        let matches = findComments(target.comments, comment)
        if (matches.length !== 1 && cached) {
            target = await resolveMutationPost(
                this.#references,
                post,
                signal,
                true
            )
            matches = findComments(target.comments, comment)
        }
        if (matches.length > 1) {
            throw new QzoneValidationError(
                '评论引用同时匹配多个层级，请传入完整 QzoneComment'
            )
        }
        if (
            matches.length === 0 &&
            !target.comments.some(
                (item) =>
                    item.id === comment.reference.id &&
                    item.author.id === comment.reference.authorId
            ) &&
            target.comments.some((item) => item.id === comment.reference.id)
        ) {
            throw new QzoneValidationError('目标评论作者与评论引用不一致')
        }
        const matched = matches[0]
        if (!matched) {
            throw new QzoneValidationError('无法从动态详情确认目标评论')
        }
        const threadRoot = commentThreadRoot(matched)
        const replyToUser = commentReplyToUser(matched)
        return this.#writeComment(
            target,
            post,
            content,
            Object.freeze({
                threadRoot,
                replyToUser
            }),
            signal
        )
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
        reply: ReplyContext | null,
        signal?: AbortSignal
    ): Promise<CommentMutationResult> {
        const sentAt = Date.now()
        const wireContent = reply?.replyToUser
            ? `${serializeReplyDisplayMarker(reply.replyToUser)} ${content}`
            : content
        let fallback: 'accepted' | 'unknown' = 'accepted'
        let receipt: MutationReceipt | undefined
        try {
            receipt = await this.#write.comment(
                target,
                wireContent,
                reply?.threadRoot,
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
            reply?.threadRoot ?? null,
            reply?.threadRoot ?? null,
            reply?.replyToUser?.id ?? null,
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

        const verified = await verifyLike(
            this.#posts,
            this.#references.feeds,
            post,
            liked
        )
        return verified
            ? likeMutationResult('verified', liked, receipt?.message, verified)
            : likeMutationResult(fallback, liked, receipt?.message)
    }
}

function findComments(
    comments: readonly QzoneComment[],
    target: NormalizedReplyTarget
): readonly QzoneComment[] {
    return comments.filter(
        (comment) =>
            comment.id === target.reference.id &&
            comment.author.id === target.reference.authorId &&
            (target.identity === null ||
                (comment.kind === target.identity.kind &&
                    sameReference(
                        comment.threadRoot,
                        target.identity.threadRoot
                    )))
    )
}

function commentThreadRoot(comment: QzoneComment): CommentReference {
    if (comment.kind === 'comment') {
        return Object.freeze({ id: comment.id, authorId: comment.author.id })
    }
    if (!comment.threadRoot) {
        throw new QzoneValidationError('二级评论缺少所属一级评论')
    }
    return comment.threadRoot
}

function commentReplyToUser(comment: QzoneComment): QzoneUser | null {
    if (comment.kind === 'comment') {
        return null
    }
    const nickname = comment.author.nickname.trim()
    if (!nickname) {
        throw new QzoneValidationError('二级评论目标缺少作者昵称')
    }
    return Object.freeze({ id: comment.author.id, nickname })
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
    readonly comment: NormalizedReplyTarget
    readonly content: string
    readonly signal?: AbortSignal
} {
    const normalized = normalizePostOptions(options)
    const comment = normalizeReplyTarget(options.comment)
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
    value: CommentReference | QzoneComment
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

function normalizeReplyTarget(
    value: ReplyOptions['comment']
): NormalizedReplyTarget {
    const reference = normalizeCommentReference(value)
    if (!('author' in value)) {
        return Object.freeze({ reference, identity: null })
    }
    if (value.kind !== 'comment' && value.kind !== 'reply') {
        throw new QzoneValidationError('评论节点类型无效')
    }
    if (value.kind === 'comment') {
        if (value.threadRoot !== null) {
            throw new QzoneValidationError('一级评论不能包含线程根引用')
        }
        return Object.freeze({
            reference,
            identity: Object.freeze({ kind: value.kind, threadRoot: null })
        })
    }
    if (!value.threadRoot) {
        throw new QzoneValidationError('二级评论缺少线程根引用')
    }
    return Object.freeze({
        reference,
        identity: Object.freeze({
            kind: value.kind,
            threadRoot: normalizeCommentReference(value.threadRoot)
        })
    })
}

function sameReference(
    left: CommentReference | null,
    right: CommentReference | null
): boolean {
    return (
        left === right ||
        (left !== null &&
            right !== null &&
            left.id === right.id &&
            left.authorId === right.authorId)
    )
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
