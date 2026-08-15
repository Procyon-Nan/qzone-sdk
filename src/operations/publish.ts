import { QzoneValidationError } from '../errors.js'
import { preparePublishImage } from '../protocol/image.js'
import type { SessionState } from '../session/session.js'
import type {
    PostMutationResult,
    PostReference,
    PublishImageInput,
    PublishPostOptions,
    QzonePost
} from '../types.js'
import { UncertainTransportError } from '../transport/fetch-transport.js'
import type { FeedOperations } from './feed.js'
import type { PostOperations } from './post.js'
import type { QzoneWriteApi } from './write.js'

const MAX_PUBLISH_IMAGES = 9
const MAX_UPLOAD_CONCURRENCY = 5
const POST_MATCH_WINDOW_MS = 5 * 60 * 1_000

export function snapshotPublishOptions(
    options: PublishPostOptions
): PublishPostOptions {
    const normalized = normalizeOptions(options)
    return Object.freeze({
        content: normalized.content,
        images: Object.freeze(normalized.images.map(snapshotPublishImage)),
        ...(normalized.signal ? { signal: normalized.signal } : {})
    })
}

export class PublishOperations {
    readonly #session: SessionState
    readonly #write: QzoneWriteApi
    readonly #feeds: FeedOperations
    readonly #posts: PostOperations

    constructor(
        session: SessionState,
        write: QzoneWriteApi,
        feeds: FeedOperations,
        posts: PostOperations
    ) {
        this.#session = session
        this.#write = write
        this.#feeds = feeds
        this.#posts = posts
    }

    async publishPost(
        options: PublishPostOptions
    ): Promise<PostMutationResult> {
        const normalized = normalizeOptions(options)
        const images = await Promise.all(
            Array.from(normalized.images, (image) => preparePublishImage(image))
        )
        const photos = await uploadAll(
            images,
            (image) => this.#write.uploadImage(image, normalized.signal),
            MAX_UPLOAD_CONCURRENCY
        )
        const sentAt = Date.now()

        try {
            const receipt = await this.#write.publishPost(
                normalized.content,
                photos,
                normalized.signal
            )
            return await this.#resolveResult(
                'accepted',
                receipt.postId,
                receipt.message,
                normalized,
                sentAt
            )
        } catch (error) {
            if (!(error instanceof UncertainTransportError)) {
                throw error
            }
            return await this.#resolveResult(
                'unknown',
                null,
                undefined,
                normalized,
                sentAt
            )
        }
    }

    async #resolveResult(
        fallback: 'accepted' | 'unknown',
        postId: string | null,
        message: string | undefined,
        options: NormalizedPublishOptions,
        sentAt: number
    ): Promise<PostMutationResult> {
        const accountId = this.#session.accountId
        const reference =
            accountId && postId
                ? Object.freeze({ id: postId, authorId: accountId })
                : undefined
        if (!accountId) {
            return mutationResult(fallback, message, reference)
        }

        const post = await this.#verify(reference, accountId, options, sentAt)
        return post
            ? mutationResult('verified', message, undefined, post)
            : mutationResult(fallback, message, reference)
    }

    async #verify(
        reference: PostReference | undefined,
        accountId: string,
        options: NormalizedPublishOptions,
        sentAt: number
    ): Promise<QzonePost | null> {
        try {
            if (reference) {
                return await this.#posts.getPost({ post: reference })
            }
            const page = await this.#feeds.listFeeds({
                scope: 'self',
                limit: 20
            })
            const latestAllowed = Date.now() + POST_MATCH_WINDOW_MS
            const earliestAllowed = sentAt - POST_MATCH_WINDOW_MS
            const expectedContent = options.content.trim()
            const matches = page.items.filter((post) => {
                if (
                    post.authorId !== accountId ||
                    post.content !== expectedContent ||
                    post.media.length !== options.images.length ||
                    !post.createdAt
                ) {
                    return false
                }
                const createdAt = Date.parse(post.createdAt)
                return (
                    Number.isFinite(createdAt) &&
                    createdAt >= earliestAllowed &&
                    createdAt <= latestAllowed
                )
            })
            return matches.length === 1 ? matches[0]! : null
        } catch {
            // A verification failure must not make an already-sent write look retryable.
            return null
        }
    }
}

interface NormalizedPublishOptions {
    readonly content: string
    readonly images: NonNullable<PublishPostOptions['images']>
    readonly signal?: AbortSignal
}

function normalizeOptions(
    options: PublishPostOptions
): NormalizedPublishOptions {
    if (!options || typeof options !== 'object') {
        throw new QzoneValidationError('发布参数必须是对象')
    }
    if (options.content !== undefined && typeof options.content !== 'string') {
        throw new QzoneValidationError('动态正文必须是字符串')
    }
    if (options.images !== undefined && !Array.isArray(options.images)) {
        throw new QzoneValidationError('发布图片必须是数组')
    }
    const content = options.content ?? ''
    const images = options.images ?? []
    if (images.length > MAX_PUBLISH_IMAGES) {
        throw new QzoneValidationError(
            `QQ 空间一次最多只能发布 ${MAX_PUBLISH_IMAGES} 张图片`
        )
    }
    if (!content.trim() && images.length === 0) {
        throw new QzoneValidationError('动态正文和图片不能同时为空')
    }
    return {
        content,
        images,
        ...(options.signal ? { signal: options.signal } : {})
    }
}

function snapshotPublishImage(input: PublishImageInput): PublishImageInput {
    if (!input || typeof input !== 'object') {
        return input
    }
    return Object.freeze({
        ...input,
        data: snapshotImageData(input.data)
    })
}

function snapshotImageData(
    data: PublishImageInput['data']
): PublishImageInput['data'] {
    if (data instanceof Uint8Array) {
        return new Uint8Array(data)
    }
    if (data instanceof ArrayBuffer) {
        return data.slice(0)
    }
    if (data instanceof Blob) {
        return data.slice()
    }
    return data
}

async function uploadAll<T, R>(
    values: readonly T[],
    upload: (value: T) => Promise<R>,
    concurrency: number
): Promise<readonly R[]> {
    const results: R[] = new Array<R>(values.length)
    let nextIndex = 0
    let failed = false
    let firstError: unknown

    const worker = async (): Promise<void> => {
        while (!failed) {
            const index = nextIndex
            nextIndex += 1
            if (index >= values.length) {
                return
            }
            try {
                results[index] = await upload(values[index]!)
            } catch (error) {
                if (!failed) {
                    failed = true
                    firstError = error
                }
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, values.length) }, async () =>
            worker()
        )
    )
    if (failed) {
        throw firstError
    }
    return results
}

function mutationResult(
    outcome: PostMutationResult['outcome'],
    message?: string,
    reference?: PostReference,
    post?: QzonePost
): PostMutationResult {
    return Object.freeze({
        outcome,
        ...(message ? { message } : {}),
        ...(reference ? { reference } : {}),
        ...(post ? { post } : {})
    })
}
