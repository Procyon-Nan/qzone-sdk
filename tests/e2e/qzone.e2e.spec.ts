import { randomUUID } from 'node:crypto'

import { describe, expect, it } from 'vitest'

import { QzoneClient, QzoneValidationError } from '../../src/index.js'
import type {
    CommentMutationResult,
    CommentReference,
    FeedPage,
    PostMutationResult,
    PostTarget,
    QzonePost
} from '../../src/index.js'
import {
    createBmpImage,
    E2eEvidence,
    e2eEnabled,
    loadE2eConfig
} from './harness.js'

interface CreatedPost {
    readonly marker: string
    target?: PostTarget
    deletionAttempted: boolean
    deleted: boolean
}

describe.skipIf(!e2eEnabled())('Qzone real E2E', () => {
    it('validates every phase-one capability and removes created posts', async () => {
        const config = await loadE2eConfig()
        if (!config.allowWrites) {
            throw new QzoneValidationError(
                '真实 E2E 写操作需要 QZONE_E2E_ALLOW_WRITES=1'
            )
        }
        if (!config.expectedAccountId) {
            throw new QzoneValidationError(
                '真实 E2E 写操作需要 QZONE_E2E_EXPECTED_ACCOUNT_ID'
            )
        }

        const runId = `${new Date().toISOString().replaceAll(/[:.]/gu, '-')}-${randomUUID()}`
        const evidence = await E2eEvidence.create(runId)
        const createdPosts: CreatedPost[] = []
        const client = new QzoneClient({
            session: config.session,
            fetch: evidence.fetch,
            logger: evidence.logger,
            onSessionChange: (session) => evidence.saveSession(session),
            requestTimeoutMs: 20_000
        })

        let failure: unknown
        try {
            await runScenario(client, evidence, createdPosts, runId, config)
        } catch (error) {
            failure = error
        }

        const cleanupProblems = await cleanupCreatedPosts(
            client,
            evidence,
            createdPosts
        )
        try {
            await evidence.saveSession(client.exportSession())
        } catch (error) {
            await evidence.note('session.export.final', {
                error: error instanceof Error ? error.message : String(error)
            })
        }
        await client.close()

        const finalFailure =
            failure ??
            (cleanupProblems.length > 0
                ? new Error(`E2E 清理未完成：${cleanupProblems.join('；')}`)
                : undefined)
        await evidence.finish(finalFailure ? 'failed' : 'passed', finalFailure)
        if (finalFailure) {
            throw finalFailure
        }
    }, 300_000)
})

async function runScenario(
    client: QzoneClient,
    evidence: E2eEvidence,
    createdPosts: CreatedPost[],
    runId: string,
    config: Awaited<ReturnType<typeof loadE2eConfig>>
): Promise<void> {
    const sessionInfo = await evidence.step(
        'session.validate',
        () => {
            const info = client.getSessionInfo()
            expect(info.authenticated).toBe(true)
            expect(info.accountId).toMatch(/^\d+$/u)
            if (config.expectedAccountId) {
                expect(info.accountId).toBe(config.expectedAccountId)
            }
            return info
        },
        (info) => ({
            accountId: info.accountId,
            authenticated: info.authenticated
        })
    )
    const accountId = sessionInfo.accountId!

    const self = await readFeed(client, evidence, 'self.first', {
        scope: 'self',
        limit: 20
    })
    expect(self.items.every((post) => post.authorId === accountId)).toBe(true)

    const friends = await readFeed(client, evidence, 'friends.first', {
        scope: 'friends',
        limit: 20
    })
    const profileUserId =
        config.profileUserId ??
        friends.items.find((post) => post.authorId !== accountId)?.authorId ??
        accountId
    const profile = await readFeed(client, evidence, 'profile.first', {
        scope: 'profile',
        userId: profileUserId,
        limit: 20
    })
    expect(profile.items.every((post) => post.authorId === profileUserId)).toBe(
        true
    )

    const paginationResults = await Promise.all([
        readNextPage(client, evidence, 'self.next', self, {
            scope: 'self',
            limit: 20
        }),
        readNextPage(client, evidence, 'friends.next', friends, {
            scope: 'friends',
            limit: 20
        }),
        readNextPage(client, evidence, 'profile.next', profile, {
            scope: 'profile',
            userId: profileUserId,
            limit: 20
        })
    ])
    expect(paginationResults.some(Boolean)).toBe(true)

    const detailTarget = selectDetailTarget(self, profile, friends)
    await evidence.step(
        'post.detail',
        async () => {
            const detail = await client.getPost({ post: detailTarget })
            expect(detail.id).toBe(detailTarget.id)
            expect(detail.authorId).toBe(detailTarget.authorId)
            expect(Array.isArray(detail.comments)).toBe(true)
            expect(Array.isArray(detail.media)).toBe(true)
            return detail
        },
        (post) => ({
            postId: post.id,
            authorId: post.authorId,
            commentCount: post.commentCount,
            commentNodeCount: post.comments.length,
            commentsComplete: post.commentsComplete,
            mediaCount: post.media.length
        })
    )

    const textPost = trackPost(createdPosts, `[qzone-sdk-e2e:${runId}:text]`)
    await evidence.step(
        'post.publish.text',
        async () => {
            const result = await client.publishPost({
                content: textPost.marker
            })
            textPost.target = mutationTarget(result)
            expect(result.outcome).toBe('verified')
            expect(textPost.target).toBeDefined()
            return result
        },
        summarizePostMutation
    )

    const imagePost = trackPost(createdPosts, `[qzone-sdk-e2e:${runId}:image]`)
    await evidence.step(
        'post.publish.image',
        async () => {
            const result = await client.publishPost({
                content: imagePost.marker,
                images: [
                    {
                        data: createBmpImage(),
                        name: 'qzone-sdk-e2e.bmp',
                        mimeType: 'image/bmp'
                    }
                ]
            })
            imagePost.target = mutationTarget(result)
            expect(result.outcome).toBe('verified')
            expect(result.post?.media).toHaveLength(1)
            expect(imagePost.target).toBeDefined()
            return result
        },
        summarizePostMutation
    )

    const comment = await evidence.step(
        'post.comment',
        async () => {
            const result = await client.comment({
                post: textPost.target!,
                content: `[qzone-sdk-e2e:${runId}:comment]`
            })
            expect(result.outcome).toBe('verified')
            expect(commentTarget(result)).toBeDefined()
            return result
        },
        summarizeCommentMutation
    )
    const commentReference = commentTarget(comment)!

    const replyContent = `[qzone-sdk-e2e:${runId}:reply]`
    const reply = await evidence.step(
        'post.reply',
        async () => {
            const result = await client.reply({
                post: textPost.target!,
                comment: commentReference,
                content: replyContent
            })
            expect(result.outcome).toBe('verified')
            expect(commentTarget(result)).toBeDefined()
            return result
        },
        summarizeCommentMutation
    )
    const replyReference = commentTarget(reply)!

    const nestedReplyContent = `[qzone-sdk-e2e:${runId}:nested-reply]`
    const ambiguousNestedTarget =
        replyReference.id === commentReference.id &&
        replyReference.authorId === commentReference.authorId
    const nestedReply = await evidence.step(
        'post.reply.nested',
        async () => {
            const result = await client.reply({
                post: textPost.target!,
                comment: replyReference,
                content: nestedReplyContent
            })
            expect(result.outcome).toBe('verified')
            expect(commentTarget(result)).toBeDefined()
            return result
        },
        summarizeCommentMutation
    )
    const nestedReplyReference = commentTarget(nestedReply)!

    await evidence.step(
        'post.reply.nested.read',
        async () => {
            const detail = await client.getPost({ post: textPost.target! })
            const root = detail.comments.find(
                (item) =>
                    item.kind === 'comment' &&
                    item.id === commentReference.id &&
                    item.author.id === commentReference.authorId
            )
            const firstReply = detail.comments.find(
                (item) =>
                    item.kind === 'reply' &&
                    item.id === replyReference.id &&
                    item.author.id === replyReference.authorId &&
                    item.content === replyContent
            )
            const secondReply = detail.comments.find(
                (item) =>
                    item.kind === 'reply' &&
                    item.id === nestedReplyReference.id &&
                    item.author.id === nestedReplyReference.authorId &&
                    item.content === nestedReplyContent
            )
            expect(root?.kind).toBe('comment')
            expect(firstReply).toMatchObject({
                kind: 'reply',
                threadRoot: commentReference
            })
            expect(secondReply).toMatchObject({
                kind: 'reply',
                threadRoot: commentReference
            })
            return { detail, root, firstReply, secondReply }
        },
        ({ detail, root, firstReply, secondReply }) => ({
            commentsComplete: detail.commentsComplete,
            rootFound: root !== undefined,
            firstReplyFound: firstReply !== undefined,
            ambiguousNestedTarget,
            nestedReplyFound: secondReply !== undefined,
            firstReplyTargetKnown: Boolean(firstReply?.replyTo),
            nestedReplyTargetKnown: Boolean(secondReply?.replyTo)
        })
    )

    await evidence.step(
        'post.like',
        async () => {
            const result = await client.like({ post: textPost.target! })
            expect(result.outcome).toBe('verified')
            expect(result.liked).toBe(true)
            return result
        },
        (result) => ({ outcome: result.outcome, liked: result.liked })
    )
    await evidence.step(
        'post.unlike',
        async () => {
            const result = await client.unlike({ post: textPost.target! })
            expect(result.outcome).toBe('verified')
            expect(result.liked).toBe(false)
            return result
        },
        (result) => ({ outcome: result.outcome, liked: result.liked })
    )

    await deleteTrackedPost(client, evidence, textPost, 'post.delete.text')
    await deleteTrackedPost(client, evidence, imagePost, 'post.delete.image')
}

async function readFeed(
    client: QzoneClient,
    evidence: E2eEvidence,
    stepName: string,
    options: Parameters<QzoneClient['listFeeds']>[0]
): Promise<FeedPage> {
    return evidence.step(
        stepName,
        async () => {
            const page = await client.listFeeds(options)
            expect(Array.isArray(page.items)).toBe(true)
            return page
        },
        summarizeFeed
    )
}

async function readNextPage(
    client: QzoneClient,
    evidence: E2eEvidence,
    stepName: string,
    first: FeedPage,
    options: Parameters<QzoneClient['listFeeds']>[0]
): Promise<boolean> {
    if (!first.nextCursor) {
        await evidence.note(stepName, { available: false })
        return false
    }
    await readFeed(client, evidence, stepName, {
        ...options,
        cursor: first.nextCursor
    })
    return true
}

function selectDetailTarget(...pages: readonly FeedPage[]): QzonePost {
    const candidates = pages.flatMap((page) => [...page.items])
    const target =
        candidates.find(
            (post) => post.comments.length > 0 || post.media.length > 0
        ) ?? candidates[0]
    if (!target) {
        throw new QzoneValidationError('真实动态流中没有可读取详情的动态')
    }
    return target
}

function trackPost(posts: CreatedPost[], marker: string): CreatedPost {
    const post = { marker, deletionAttempted: false, deleted: false }
    posts.push(post)
    return post
}

async function deleteTrackedPost(
    client: QzoneClient,
    evidence: E2eEvidence,
    post: CreatedPost,
    stepName: string
): Promise<void> {
    await evidence.step(
        stepName,
        async () => {
            post.deletionAttempted = true
            const result = await client.deleteOwnPost({ post: post.target! })
            expect(result.outcome).toBe('verified')
            post.deleted = true
            return result
        },
        summarizePostMutation
    )
}

async function cleanupCreatedPosts(
    client: QzoneClient,
    evidence: E2eEvidence,
    posts: CreatedPost[]
): Promise<string[]> {
    const problems: string[] = []
    const accountId = client.getSessionInfo().accountId
    for (const post of [...posts].reverse()) {
        if (post.deleted) {
            continue
        }
        if (post.deletionAttempted) {
            const message = `${post.marker} 已发送删除请求但结果未经确认，未重复写入`
            problems.push(message)
            await evidence.note('cleanup.skipped', {
                marker: post.marker,
                message
            })
            continue
        }

        try {
            const confirmed = await confirmCleanupTarget(
                client,
                post,
                accountId
            )
            if (!confirmed) {
                const message = `${post.marker} 无法确认动态归属或正文，已停止清理`
                problems.push(message)
                await evidence.note('cleanup.rejected', {
                    marker: post.marker,
                    message
                })
                continue
            }
            post.target = confirmed
            post.deletionAttempted = true
            const result = await client.deleteOwnPost({ post: confirmed })
            if (result.outcome !== 'verified') {
                const message = `${post.marker} 清理结果为 ${result.outcome}`
                problems.push(message)
                await evidence.note('cleanup.unverified', {
                    marker: post.marker,
                    outcome: result.outcome
                })
                continue
            }
            post.deleted = true
            await evidence.note('cleanup.deleted', {
                marker: post.marker,
                postId: confirmed.id,
                outcome: result.outcome
            })
        } catch (error) {
            const message = `${post.marker} 清理失败：${error instanceof Error ? error.message : String(error)}`
            problems.push(message)
            await evidence.note('cleanup.failed', {
                marker: post.marker,
                message
            })
        }
    }
    return problems
}

async function confirmCleanupTarget(
    client: QzoneClient,
    post: CreatedPost,
    accountId: string | null
): Promise<QzonePost | null> {
    if (!accountId) {
        return null
    }
    if (post.target) {
        try {
            const detail = await client.getPost({ post: post.target })
            return detail.authorId === accountId &&
                detail.content === post.marker
                ? detail
                : null
        } catch {
            return null
        }
    }

    let page = await client.listFeeds({ scope: 'self', limit: 20 })
    for (let round = 0; round < 3; round += 1) {
        const matches = page.items.filter(
            (item) =>
                item.authorId === accountId && item.content === post.marker
        )
        if (matches.length === 1) {
            return matches[0]!
        }
        if (!page.nextCursor) {
            return null
        }
        page = await client.listFeeds({
            scope: 'self',
            limit: 20,
            cursor: page.nextCursor
        })
    }
    return null
}

function mutationTarget(result: PostMutationResult): PostTarget | undefined {
    return result.post ?? result.reference
}

function commentTarget(
    result: CommentMutationResult
): CommentReference | undefined {
    return result.comment
        ? { id: result.comment.id, authorId: result.comment.author.id }
        : result.reference
}

function summarizeFeed(page: FeedPage): Record<string, unknown> {
    return {
        itemCount: page.items.length,
        nextCursorAvailable: page.nextCursor !== null
    }
}

function summarizePostMutation(
    result: PostMutationResult
): Record<string, unknown> {
    return {
        outcome: result.outcome,
        postId: result.post?.id ?? result.reference?.id ?? null
    }
}

function summarizeCommentMutation(
    result: CommentMutationResult
): Record<string, unknown> {
    return {
        outcome: result.outcome,
        commentId: result.comment?.id ?? result.reference?.id ?? null
    }
}
