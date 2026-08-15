export type QzoneId = string
export type QzoneTimestamp = string

export interface QzoneUser {
    readonly id: QzoneId
    readonly nickname: string
    readonly avatarUrl?: string
}

interface QzoneMediaBase {
    readonly url: string
    readonly name?: string
    readonly mimeType?: string
    readonly size?: number
}

export interface QzoneImageMedia extends QzoneMediaBase {
    readonly kind: 'image'
    readonly width?: number
    readonly height?: number
}

export interface QzoneVideoMedia extends QzoneMediaBase {
    readonly kind: 'video'
    readonly previewUrl?: string
    readonly durationMs?: number
}

export interface QzoneAudioMedia extends QzoneMediaBase {
    readonly kind: 'audio'
    readonly durationMs?: number
}

export interface QzoneFileMedia extends QzoneMediaBase {
    readonly kind: 'file'
}

export type QzoneMedia =
    QzoneImageMedia | QzoneVideoMedia | QzoneAudioMedia | QzoneFileMedia

export interface QzoneComment {
    readonly id: QzoneId
    readonly author: QzoneUser
    readonly content: string
    readonly createdAt: QzoneTimestamp | null
    readonly parentId: QzoneId | null
}

export interface PostReference {
    readonly id: QzoneId
    readonly authorId: QzoneId
}

export interface QzonePost extends PostReference {
    readonly author: QzoneUser
    readonly content: string
    readonly createdAt: QzoneTimestamp | null
    readonly likeCount: number
    readonly commentCount: number
    readonly liked: boolean
    readonly media: readonly QzoneMedia[]
    readonly comments: readonly QzoneComment[]
}

export type FeedScope = 'self' | 'profile' | 'friends'

interface ListFeedsOptionsBase {
    readonly limit?: number
    readonly cursor?: string
    readonly signal?: AbortSignal
}

export interface ListSelfFeedsOptions extends ListFeedsOptionsBase {
    readonly scope: 'self'
    readonly userId?: never
}

export interface ListProfileFeedsOptions extends ListFeedsOptionsBase {
    readonly scope: 'profile'
    readonly userId: QzoneId
}

export interface ListFriendsFeedsOptions extends ListFeedsOptionsBase {
    readonly scope: 'friends'
    readonly userId?: never
}

export type ListFeedsOptions =
    ListSelfFeedsOptions | ListProfileFeedsOptions | ListFriendsFeedsOptions

export interface FeedPage {
    readonly items: readonly QzonePost[]
    readonly nextCursor: string | null
}

export type PostTarget = PostReference | QzonePost

export interface GetPostOptions {
    readonly post: PostTarget
    readonly signal?: AbortSignal
}

export interface PublishImageInput {
    readonly data: Uint8Array | ArrayBuffer | Blob
    readonly name: string
    readonly mimeType?: string
}

export interface PublishPostOptions {
    readonly content?: string
    readonly images?: readonly PublishImageInput[]
    readonly signal?: AbortSignal
}

interface PostMutationOptions {
    readonly post: PostTarget
    readonly signal?: AbortSignal
}

export interface CommentOptions extends PostMutationOptions {
    readonly content: string
}

export interface CommentReference {
    readonly id: QzoneId
    readonly authorId: QzoneId
}

export interface ReplyOptions extends PostMutationOptions {
    readonly comment: CommentReference | QzoneComment
    readonly content: string
}

export type LikeOptions = PostMutationOptions
export type UnlikeOptions = PostMutationOptions
export type DeleteOwnPostOptions = PostMutationOptions

export type MutationOutcome =
    'verified' | 'accepted' | 'unknown' | 'already-applied'

interface MutationResultBase {
    readonly outcome: MutationOutcome
    readonly message?: string
}

export interface PostMutationResult extends MutationResultBase {
    readonly post?: QzonePost
    readonly reference?: PostReference
}

export interface CommentMutationResult extends MutationResultBase {
    readonly comment?: QzoneComment
    readonly reference?: CommentReference
}

export interface LikeMutationResult extends MutationResultBase {
    readonly liked: boolean
    readonly post?: QzonePost
}

export type QzoneCookieInput = string | Readonly<Record<string, string>>

export interface QzoneSessionInput {
    readonly accountId?: QzoneId
    readonly cookies: QzoneCookieInput
    readonly tokens?: Readonly<Record<QzoneId, string>>
    readonly updatedAt?: QzoneTimestamp
}

export interface QzoneSession {
    readonly accountId: QzoneId
    readonly cookies: Readonly<Record<string, string>>
    readonly tokens: Readonly<Record<QzoneId, string>>
    readonly updatedAt: QzoneTimestamp
}

export interface SessionInfo {
    readonly accountId: QzoneId | null
    readonly authenticated: boolean
    readonly updatedAt: QzoneTimestamp | null
    readonly persistencePending: boolean
}

export type SessionChangeHandler = (
    session: QzoneSession
) => void | Promise<void>

export type QzoneLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface QzoneLogEvent {
    readonly level: QzoneLogLevel
    readonly phase: string
    readonly endpoint?: string
    readonly durationMs?: number
    readonly retryCount?: number
    readonly statusCode?: number
    readonly errorCode?: string
}

export type QzoneLogger = (event: QzoneLogEvent) => void

export interface QzoneClientOptions {
    readonly session: QzoneSessionInput
    readonly fetch?: typeof globalThis.fetch
    readonly logger?: QzoneLogger
    readonly onSessionChange?: SessionChangeHandler
    readonly requestTimeoutMs?: number
}
