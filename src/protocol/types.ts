import type { QzoneComment, QzoneId, QzoneMedia, QzonePost } from '../types.js'

export interface ProtocolPostAction {
    readonly appId: number
    readonly currentLikeKey: string
    readonly unlikeKey: string
    readonly topicId: string
    readonly businessParameters: Readonly<Record<string, unknown>>
}

export interface ProtocolPost {
    readonly id: QzoneId
    readonly authorId: QzoneId
    readonly authorNickname: string
    readonly authorAvatarUrl?: string
    readonly content: string
    readonly createdAt: string | null
    readonly likeCount: number
    readonly commentCount: number
    readonly liked: boolean
    readonly media: readonly QzoneMedia[]
    readonly comments: readonly QzoneComment[]
    readonly action: ProtocolPostAction
}

export interface ProtocolFeedPage {
    readonly items: readonly ProtocolPost[]
    readonly cursor: string | null
    readonly hasMore: boolean
}

export function toPublicPost(post: ProtocolPost): QzonePost {
    return Object.freeze({
        id: post.id,
        authorId: post.authorId,
        author: Object.freeze({
            id: post.authorId,
            nickname: post.authorNickname,
            ...(post.authorAvatarUrl ? { avatarUrl: post.authorAvatarUrl } : {})
        }),
        content: post.content,
        createdAt: post.createdAt,
        likeCount: post.likeCount,
        commentCount: post.commentCount,
        liked: post.liked,
        media: Object.freeze([...post.media]),
        comments: Object.freeze([...post.comments])
    })
}
