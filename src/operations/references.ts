import { QzoneRequestError } from '../errors.js'
import type { ProtocolPost } from '../protocol/types.js'
import type { SessionState } from '../session/session.js'
import type { PostTarget } from '../types.js'
import type { FeedOperations } from './feed.js'
import type { PostOperations } from './post.js'
import { shouldFallbackRead } from './read.js'

export interface MutationReferenceContext {
    readonly session: SessionState
    readonly posts: PostOperations
    readonly feeds: FeedOperations
}

export async function resolveMutationPost(
    context: MutationReferenceContext,
    post: PostTarget,
    signal?: AbortSignal,
    refresh = false
): Promise<ProtocolPost> {
    try {
        return await context.posts.resolvePost(post, signal, refresh)
    } catch (detailError) {
        if (!shouldFallbackMutationReference(detailError)) {
            throw detailError
        }
        const page = await context.feeds.listFeeds(
            post.authorId === context.session.accountId
                ? { scope: 'self', limit: 20, signal }
                : {
                      scope: 'profile',
                      userId: post.authorId,
                      limit: 20,
                      signal
                  }
        )
        if (
            !page.items.some(
                (item) => item.id === post.id && item.authorId === post.authorId
            )
        ) {
            throw detailError
        }
        const resolved = context.posts.getCachedPost(post)
        if (!resolved) {
            throw detailError
        }
        return resolved
    }
}

function shouldFallbackMutationReference(error: unknown): boolean {
    return (
        shouldFallbackRead(error) ||
        (error instanceof QzoneRequestError &&
            error.context?.statusCode === 404)
    )
}
