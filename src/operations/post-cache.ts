import type { ProtocolFeedPage, ProtocolPost } from '../protocol/types.js'
import type { QzoneId } from '../types.js'

const MAX_POST_CACHE_ENTRIES = 512

export class PostCache {
    readonly #posts = new Map<string, ProtocolPost>()
    readonly #references = new Map<string, string>()

    get(authorId: QzoneId, postId: QzoneId): ProtocolPost | undefined {
        const identity = this.#references.get(referenceKey(authorId, postId))
        const post = identity ? this.#posts.get(identity) : undefined
        if (identity && post) {
            this.#posts.delete(identity)
            this.#posts.set(identity, post)
        }
        return post
    }

    set(post: ProtocolPost): void {
        const identity = postIdentity(post)
        const reference = referenceKey(post.authorId, post.id)
        const previousIdentity = this.#references.get(reference)
        if (previousIdentity && previousIdentity !== identity) {
            this.#posts.delete(previousIdentity)
        }
        this.#posts.delete(identity)
        this.#posts.set(identity, post)
        this.#references.set(reference, identity)
        this.#prune()
    }

    setPage(page: ProtocolFeedPage): void {
        for (const post of page.items) {
            const current = this.get(post.authorId, post.id)
            this.set(
                current?.commentsComplete && !post.commentsComplete
                    ? Object.freeze({
                          ...post,
                          commentCount: Math.max(
                              post.commentCount,
                              current.commentCount
                          ),
                          comments: current.comments,
                          commentsComplete: true,
                          commentSnapshotPresent: current.commentSnapshotPresent
                      })
                    : post
            )
        }
    }

    delete(authorId: QzoneId, postId: QzoneId): void {
        const reference = referenceKey(authorId, postId)
        const identity = this.#references.get(reference)
        if (identity) {
            this.#posts.delete(identity)
            this.#references.delete(reference)
        }
    }

    clear(): void {
        this.#posts.clear()
        this.#references.clear()
    }

    #prune(): void {
        while (this.#posts.size > MAX_POST_CACHE_ENTRIES) {
            const oldestIdentity = this.#posts.keys().next().value
            if (!oldestIdentity) {
                return
            }
            const post = this.#posts.get(oldestIdentity)
            this.#posts.delete(oldestIdentity)
            if (post) {
                const reference = referenceKey(post.authorId, post.id)
                if (this.#references.get(reference) === oldestIdentity) {
                    this.#references.delete(reference)
                }
            }
        }
    }
}

export function postIdentity(post: ProtocolPost): string {
    return `${referenceKey(post.authorId, post.id)}\u0000${post.action.appId}`
}

function referenceKey(authorId: QzoneId, postId: QzoneId): string {
    return `${authorId}\u0000${postId}`
}
