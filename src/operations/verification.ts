import { QzoneRequestError } from '../errors.js'
import type { SessionState } from '../session/session.js'
import type {
    CommentReference,
    PostTarget,
    QzoneComment,
    QzonePost
} from '../types.js'
import type { PostOperations } from './post.js'

const COMMENT_MATCH_WINDOW_MS = 5 * 60 * 1_000
const VERIFICATION_DELAYS_MS = [0, 50, 150] as const

export async function verifyComment(
    session: SessionState,
    posts: PostOperations,
    post: PostTarget,
    content: string,
    replyTo: CommentReference | null,
    receiptId: string | null,
    sentAt: number,
    signal?: AbortSignal
): Promise<QzoneComment | null> {
    const accountId = session.accountId
    if (!accountId) {
        return null
    }
    const latestAllowed = Date.now() + COMMENT_MATCH_WINDOW_MS
    const earliestAllowed = sentAt - COMMENT_MATCH_WINDOW_MS
    const verified = await verifyPost(
        posts,
        post,
        (value) => {
            if (receiptId) {
                return value.comments.some(
                    (comment) =>
                        comment.id === receiptId &&
                        comment.author.id === accountId &&
                        comment.parentId === (replyTo?.id ?? null)
                )
            }
            return (
                matchingComments(
                    value,
                    accountId,
                    content,
                    replyTo?.id ?? null,
                    earliestAllowed,
                    latestAllowed
                ).length === 1
            )
        },
        signal
    )
    if (!verified) {
        return null
    }
    if (receiptId) {
        return (
            verified.comments.find(
                (comment) =>
                    comment.id === receiptId &&
                    comment.author.id === accountId &&
                    comment.parentId === (replyTo?.id ?? null)
            ) ?? null
        )
    }
    return (
        matchingComments(
            verified,
            accountId,
            content,
            replyTo?.id ?? null,
            earliestAllowed,
            latestAllowed
        )[0] ?? null
    )
}

export async function verifyPost(
    posts: PostOperations,
    post: PostTarget,
    matches: (post: QzonePost) => boolean,
    signal?: AbortSignal
): Promise<QzonePost | null> {
    for (const delayMs of VERIFICATION_DELAYS_MS) {
        if (signal?.aborted) {
            return null
        }
        if (delayMs > 0) {
            await wait(delayMs)
        }
        try {
            const current = await posts.getPost({ post, signal })
            if (matches(current)) {
                return current
            }
        } catch {
            // Verification never makes an already-sent write retryable.
        }
    }
    return null
}

export async function verifyDeleted(
    posts: PostOperations,
    post: PostTarget,
    signal?: AbortSignal
): Promise<boolean> {
    for (const delayMs of VERIFICATION_DELAYS_MS) {
        if (signal?.aborted) {
            return false
        }
        if (delayMs > 0) {
            await wait(delayMs)
        }
        try {
            await posts.getPost({ post, signal })
        } catch (error) {
            if (
                error instanceof QzoneRequestError &&
                error.context?.statusCode === 404
            ) {
                return true
            }
            return false
        }
    }
    return false
}

function matchingComments(
    post: QzonePost,
    accountId: string,
    content: string,
    parentId: string | null,
    earliestAllowed: number,
    latestAllowed: number
): readonly QzoneComment[] {
    return post.comments.filter((comment) => {
        if (
            comment.author.id !== accountId ||
            comment.content !== content.trim() ||
            comment.parentId !== parentId ||
            !comment.createdAt
        ) {
            return false
        }
        const createdAt = Date.parse(comment.createdAt)
        return (
            Number.isFinite(createdAt) &&
            createdAt >= earliestAllowed &&
            createdAt <= latestAllowed
        )
    })
}

function wait(delayMs: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, delayMs))
}
