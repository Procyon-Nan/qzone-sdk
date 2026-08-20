import { QzoneNotFoundError } from '../errors.js'
import type { SessionState } from '../session/session.js'
import type {
    CommentReference,
    PostTarget,
    QzoneComment,
    QzonePost
} from '../types.js'
import type { PostOperations } from './post.js'
import type { FeedOperations } from './feed.js'

const COMMENT_MATCH_WINDOW_MS = 5 * 60 * 1_000
const VERIFICATION_DELAYS_MS = [0, 50, 150] as const

export async function verifyComment(
    session: SessionState,
    posts: PostOperations,
    post: PostTarget,
    content: string,
    replyTo: CommentReference | null,
    threadRoot: CommentReference | null,
    replyToUserId: string | null,
    receiptId: string | null,
    sentAt: number
): Promise<QzoneComment | null> {
    const accountId = session.accountId
    if (!accountId) {
        return null
    }
    const latestAllowed = Date.now() + COMMENT_MATCH_WINDOW_MS
    const earliestAllowed = sentAt - COMMENT_MATCH_WINDOW_MS
    const verified = await verifyPost(posts, post, (value) => {
        return (
            matchingComments(
                value,
                accountId,
                content,
                replyTo,
                threadRoot,
                replyToUserId,
                receiptId,
                earliestAllowed,
                latestAllowed
            ).length === 1
        )
    })
    if (!verified) {
        return null
    }
    return (
        matchingComments(
            verified,
            accountId,
            content,
            replyTo,
            threadRoot,
            replyToUserId,
            receiptId,
            earliestAllowed,
            latestAllowed
        )[0] ?? null
    )
}

export async function verifyPost(
    posts: PostOperations,
    post: PostTarget,
    matches: (post: QzonePost) => boolean
): Promise<QzonePost | null> {
    for (const delayMs of VERIFICATION_DELAYS_MS) {
        if (delayMs > 0) {
            await wait(delayMs)
        }
        try {
            const current = await posts.getPost({ post })
            if (matches(current)) {
                return current
            }
        } catch {
            // Verification never makes an already-sent write retryable.
        }
    }
    return null
}

export async function verifyLike(
    posts: PostOperations,
    feeds: FeedOperations,
    post: PostTarget,
    liked: boolean
): Promise<QzonePost | null> {
    const detail = await verifyPost(
        posts,
        post,
        (value) => value.liked === liked
    )
    if (detail) {
        return detail
    }

    try {
        const page = await feeds.listFeeds({ scope: 'friends', limit: 20 })
        return (
            page.items.find(
                (value) =>
                    value.id === post.id &&
                    value.authorId === post.authorId &&
                    value.liked === liked
            ) ?? null
        )
    } catch {
        // Verification never makes an already-sent write retryable.
        return null
    }
}

export async function verifyDeleted(
    posts: PostOperations,
    post: PostTarget
): Promise<boolean> {
    for (const delayMs of VERIFICATION_DELAYS_MS) {
        if (delayMs > 0) {
            await wait(delayMs)
        }
        try {
            await posts.getPost({ post })
        } catch (error) {
            if (error instanceof QzoneNotFoundError) {
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
    replyTo: CommentReference | null,
    threadRoot: CommentReference | null,
    replyToUserId: string | null,
    receiptId: string | null,
    earliestAllowed: number,
    latestAllowed: number
): readonly QzoneComment[] {
    return post.comments.filter((comment) => {
        if (
            (receiptId !== null && comment.id !== receiptId) ||
            comment.author.id !== accountId ||
            comment.content !== content.trim() ||
            !comment.createdAt
        ) {
            return false
        }
        if (replyTo) {
            if (
                comment.kind !== 'reply' ||
                (threadRoot !== null &&
                    (comment.threadRoot?.id !== threadRoot.id ||
                        comment.threadRoot.authorId !== threadRoot.authorId)) ||
                (replyToUserId !== null &&
                    comment.replyToUser?.id !== replyToUserId)
            ) {
                return false
            }
        } else if (comment.kind !== 'comment') {
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
