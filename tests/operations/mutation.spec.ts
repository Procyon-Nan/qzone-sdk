import { describe, expect, it } from 'vitest'

import {
    QzoneAuthError,
    QzoneClient,
    QzoneValidationError
} from '../../src/index.js'
import { createFakeFetch } from '../support/fake-fetch.js'
import { jsonResponse, textResponse } from '../support/fixtures.js'

describe('social mutation operations', () => {
    it('comments with cached protocol metadata and verifies the returned ID', async () => {
        const now = epochSeconds()
        const fake = createFakeFetch([
            detail(post({ time: now, busiParam: { source: 'detail' } })),
            async (request) => {
                expect(request.url).toContain('/emotion_cgi_re_feeds')
                const form = new URLSearchParams(await request.text())
                expect(form.get('topicId')).toBe('20002_post-1__1')
                expect(form.get('uin')).toBe('10001')
                expect(form.get('hostUin')).toBe('20002')
                expect(form.get('content')).toBe('  评论正文\n')
                expect(form.get('busi_param')).toBe('{"source":"detail"}')
                expect(form.has('commentId')).toBe(false)
                return jsonResponse({ code: 0, data: { commentid: 'c-new' } })
            },
            detail(
                post({
                    time: now,
                    comments: [comment('c-new', '10001', '评论正文', now)]
                })
            )
        ])

        const result = await createClient(fake.fetch).comment({
            post: reference(),
            content: '  评论正文\n'
        })

        expect(result).toMatchObject({
            outcome: 'verified',
            comment: { id: 'c-new', content: '评论正文' }
        })
    })

    it('recovers missing action metadata from the target profile list', async () => {
        const now = epochSeconds()
        const fake = createFakeFetch([
            textResponse('missing detail', { status: 404 }),
            textResponse(
                profileHtml({
                    vFeeds: [
                        post({
                            appId: 202,
                            time: now,
                            busiParam: { source: 'profile' }
                        })
                    ],
                    hasmore: 0
                })
            ),
            async (request) => {
                const form = new URLSearchParams(await request.text())
                expect(form.get('appid')).toBe('202')
                expect(form.get('busi_param')).toBe('{"source":"profile"}')
                return jsonResponse({ data: { commentid: 'from-profile' } })
            },
            detail(
                post({
                    appId: 202,
                    time: now,
                    comments: [comment('from-profile', '10001', 'comment', now)]
                })
            )
        ])

        const result = await createClient(fake.fetch).comment({
            post: reference(),
            content: 'comment'
        })

        expect(result).toMatchObject({
            outcome: 'verified',
            comment: { id: 'from-profile' }
        })
    })

    it('replies with the comment identity and verifies the nested reply', async () => {
        const now = epochSeconds()
        const parent = comment('parent', '30003', '原评论', now)
        const fake = createFakeFetch([
            detail(post({ time: now, comments: [parent] })),
            async (request) => {
                const form = new URLSearchParams(await request.text())
                expect(form.get('commentId')).toBe('parent')
                expect(form.get('commentUin')).toBe('30003')
                expect(form.get('content')).toBe('回复内容')
                return jsonResponse({ data: { commentId: 'reply-new' } })
            },
            detail(
                post({
                    time: now,
                    comments: [
                        {
                            ...parent,
                            replyList: [
                                comment('reply-new', '10001', '回复内容', now)
                            ]
                        }
                    ]
                })
            )
        ])

        const result = await createClient(fake.fetch).reply({
            post: reference(),
            comment: { id: 'parent', authorId: '30003' },
            content: '回复内容'
        })

        expect(result).toMatchObject({
            outcome: 'verified',
            comment: { id: 'reply-new', parentId: 'parent' }
        })
    })

    it('rejects empty comments and invalid reply references before writing', async () => {
        const fake = createFakeFetch([])
        const client = createClient(fake.fetch)

        await expect(
            client.comment({ post: reference(), content: '  ' })
        ).rejects.toBeInstanceOf(QzoneValidationError)
        await expect(
            client.reply({
                post: reference(),
                comment: { id: '', authorId: '30003' },
                content: 'reply'
            })
        ).rejects.toBeInstanceOf(QzoneValidationError)
        expect(fake.calls).toHaveLength(0)
    })

    it('keeps an accepted comment reference when display sync is delayed', async () => {
        const now = epochSeconds()
        const stale = detail(post({ time: now }))
        const fake = createFakeFetch([
            stale,
            jsonResponse({ data: { commentid: 'pending-comment' } }),
            stale,
            stale,
            stale
        ])

        const result = await createClient(fake.fetch).comment({
            post: reference(),
            content: 'pending'
        })

        expect(result).toEqual({
            outcome: 'accepted',
            reference: { id: 'pending-comment', authorId: '10001' }
        })
    })

    it('verifies a no-ID comment only through one recent matching candidate', async () => {
        const now = epochSeconds()
        const fake = createFakeFetch([
            detail(post({ time: now })),
            jsonResponse({ code: 0 }),
            detail(
                post({
                    time: now,
                    comments: [comment('matched', '10001', 'same', now)]
                })
            )
        ])

        const result = await createClient(fake.fetch).comment({
            post: reference(),
            content: 'same'
        })

        expect(result).toMatchObject({
            outcome: 'verified',
            comment: { id: 'matched' }
        })
    })

    it('returns unknown after an uncertain comment without sending it twice', async () => {
        const now = epochSeconds()
        const stale = detail(post({ time: now }))
        const fake = createFakeFetch([
            stale,
            () => {
                throw new Error('connection reset')
            },
            stale,
            stale,
            stale
        ])

        const result = await createClient(fake.fetch).comment({
            post: reference(),
            content: 'uncertain'
        })

        expect(result).toEqual({ outcome: 'unknown' })
        expect(
            fake.calls.filter((request) => request.method === 'POST')
        ).toHaveLength(1)
    })

    it('fails definitely when the write reports an expired session', async () => {
        const now = epochSeconds()
        const fake = createFakeFetch([
            detail(post({ time: now })),
            jsonResponse({ code: -3000, msg: '请先登录' })
        ])

        await expect(
            createClient(fake.fetch).comment({
                post: reference(),
                content: 'expired session'
            })
        ).rejects.toBeInstanceOf(QzoneAuthError)

        expect(
            fake.calls.filter((request) => request.method === 'POST')
        ).toHaveLength(1)
        expect(fake.calls).toHaveLength(2)
    })

    it('does not send an uncertain reply twice', async () => {
        const now = epochSeconds()
        const parent = comment('parent', '30003', 'original', now)
        const stale = detail(post({ time: now, comments: [parent] }))
        const fake = createFakeFetch([
            stale,
            () => {
                throw new Error('connection reset')
            },
            stale,
            stale,
            stale
        ])

        const result = await createClient(fake.fetch).reply({
            post: reference(),
            comment: { id: 'parent', authorId: '30003' },
            content: 'uncertain reply'
        })

        expect(result).toEqual({ outcome: 'unknown' })
        expect(
            fake.calls.filter((request) => request.method === 'POST')
        ).toHaveLength(1)
    })

    it('returns already-applied when the current like state matches', async () => {
        const fake = createFakeFetch([detail(post({ liked: true }))])

        const result = await createClient(fake.fetch).like({
            post: reference()
        })

        expect(result).toMatchObject({
            outcome: 'already-applied',
            liked: true,
            post: { liked: true }
        })
        expect(fake.calls).toHaveLength(1)
    })

    it('does not reuse stale cache when reference refresh and list fallback both miss', async () => {
        const fake = createFakeFetch([
            textResponse(
                profileHtml({
                    vFeeds: [post({ appId: 202, liked: false })],
                    hasmore: 0
                })
            ),
            textResponse('missing detail', { status: 404 }),
            textResponse(profileHtml({ vFeeds: [], hasmore: 0 }))
        ])
        const client = createClient(fake.fetch)
        await client.listFeeds({
            scope: 'profile',
            userId: '20002',
            limit: 20
        })

        await expect(client.like({ post: reference() })).rejects.toMatchObject({
            context: { statusCode: 404 }
        })
        expect(
            fake.calls.filter((request) => request.method === 'POST')
        ).toHaveLength(0)
    })

    it('falls back only after a definite unavailable like endpoint', async () => {
        const fake = createFakeFetch([
            detail(
                post({ liked: false, curkey: 'real-cur', unikey: 'real-uni' })
            ),
            textResponse('missing', { status: 404 }),
            async (request) => {
                expect(request.url).toContain('w.qzone.qq.com/cgi-bin/likes')
                expect(request.url).not.toContain('/proxy/domain/')
                const form = new URLSearchParams(await request.text())
                expect(form.get('curkey')).toBe('real-cur')
                expect(form.get('unikey')).toBe('real-uni')
                expect(form.get('opr_type')).toBe('like')
                return jsonResponse({ ret: 0, msg: 'ok' })
            },
            detail(post({ liked: true }))
        ])

        const result = await createClient(fake.fetch).like({
            post: reference()
        })

        expect(result).toMatchObject({
            outcome: 'verified',
            liked: true,
            message: 'ok'
        })
    })

    it('accepts a safe QQ redirect as a like receipt', async () => {
        const fake = createFakeFetch([
            detail(post({ liked: false })),
            textResponse('', {
                status: 302,
                headers: { location: 'https://user.qzone.qq.com/10001' }
            }),
            detail(post({ liked: true }))
        ])

        const result = await createClient(fake.fetch).like({
            post: reference()
        })

        expect(result).toMatchObject({ outcome: 'verified', liked: true })
        expect(fake.calls).toHaveLength(3)
    })

    it('verifies a like from the friends feed when detail state stays stale', async () => {
        const stale = detail(post({ liked: false }))
        const fake = createFakeFetch([
            stale,
            jsonResponse({ ret: 0, msg: 'ok' }),
            stale,
            stale,
            stale,
            textResponse('', {
                status: 302,
                headers: { location: 'https://user.qzone.qq.com/10001' }
            }),
            jsonResponse([
                {
                    appid: 311,
                    key: 'post-1',
                    opuin: '20002',
                    abstime: epochSeconds(),
                    html: [
                        '<li><div class="f-info">post</div>',
                        '<a data-islike="1" data-likecnt="2"></a></li>'
                    ].join('')
                }
            ])
        ])

        const result = await createClient(fake.fetch).like({
            post: reference()
        })

        expect(result).toMatchObject({
            outcome: 'verified',
            liked: true,
            message: 'ok',
            post: { id: 'post-1', authorId: '20002', liked: true }
        })
        expect(
            fake.calls.filter((request) => request.method === 'POST')
        ).toHaveLength(1)
    })

    it('does not try the direct like endpoint after an uncertain proxy write', async () => {
        const stale = detail(post({ liked: false }))
        const fake = createFakeFetch([
            stale,
            () => {
                throw new Error('connection reset')
            },
            stale,
            stale,
            stale
        ])

        const result = await createClient(fake.fetch).like({
            post: reference()
        })

        expect(result).toEqual({ outcome: 'unknown', liked: true })
        expect(
            fake.calls.filter((request) => request.method === 'POST')
        ).toHaveLength(1)
        expect(fake.calls[1]?.url).toContain('/proxy/domain/')
    })

    it('unlikes and verifies the target state', async () => {
        const fake = createFakeFetch([
            detail(post({ liked: true })),
            async (request) => {
                const form = new URLSearchParams(await request.text())
                expect(request.url).toContain('internal_unlike_app')
                expect(form.get('opr_type')).toBe('unlike')
                return jsonResponse({ ret: 0 })
            },
            detail(post({ liked: false }))
        ])

        const result = await createClient(fake.fetch).unlike({
            post: reference()
        })

        expect(result).toMatchObject({ outcome: 'verified', liked: false })
    })
})

describe('delete own post', () => {
    it('rejects another author before any request', async () => {
        const fake = createFakeFetch([])

        await expect(
            createClient(fake.fetch).deleteOwnPost({
                post: { id: 'post-1', authorId: '20002' }
            })
        ).rejects.toBeInstanceOf(QzoneValidationError)
        expect(fake.calls).toHaveLength(0)
    })

    it('uses the real creation time and verifies explicit absence', async () => {
        const createdAt = 1_700_000_000
        const fake = createFakeFetch([
            detail(post({ authorId: '10001', time: createdAt })),
            async (request) => {
                expect(request.url).toContain('/emotion_cgi_delete_v6')
                const form = new URLSearchParams(await request.text())
                expect(form.get('feedsKey')).toBe('post-1')
                expect(form.get('feedsTime')).toBe(String(createdAt))
                return jsonResponse({ code: 0, msg: 'deleted' })
            },
            textResponse('not found', { status: 404 })
        ])

        const result = await createClient(fake.fetch).deleteOwnPost({
            post: ownReference()
        })

        expect(result).toEqual({
            outcome: 'verified',
            message: 'deleted',
            reference: ownReference()
        })
    })

    it('rejects deletion when the real creation time cannot be read', async () => {
        const fake = createFakeFetch([
            detail(post({ authorId: '10001', time: undefined }))
        ])

        await expect(
            createClient(fake.fetch).deleteOwnPost({ post: ownReference() })
        ).rejects.toThrow('无法确认动态真实创建时间')
        expect(fake.calls).toHaveLength(1)
    })

    it('returns accepted when a successful deletion is still visible', async () => {
        const stale = detail(post({ authorId: '10001', time: epochSeconds() }))
        const fake = createFakeFetch([
            stale,
            jsonResponse({ code: 0 }),
            stale,
            stale,
            stale
        ])

        const result = await createClient(fake.fetch).deleteOwnPost({
            post: ownReference()
        })

        expect(result).toEqual({
            outcome: 'accepted',
            reference: ownReference()
        })
    })

    it('verifies deletion from the QQ deleted-post service code', async () => {
        const createdAt = epochSeconds()
        const fake = createFakeFetch([
            detail(post({ authorId: '10001', time: createdAt })),
            jsonResponse({ code: 0, msg: 'deleted' }),
            jsonResponse({
                code: -8,
                message: '对不起，原文已经被删除，无法查看'
            })
        ])

        const result = await createClient(fake.fetch).deleteOwnPost({
            post: ownReference()
        })

        expect(result).toEqual({
            outcome: 'verified',
            message: 'deleted',
            reference: ownReference()
        })
    })

    it('returns verified after an uncertain deletion is read as absent', async () => {
        const fake = createFakeFetch([
            detail(post({ authorId: '10001', time: epochSeconds() })),
            () => {
                throw new Error('connection reset')
            },
            textResponse('not found', { status: 404 })
        ])

        const result = await createClient(fake.fetch).deleteOwnPost({
            post: ownReference()
        })

        expect(result).toEqual({
            outcome: 'verified',
            reference: ownReference()
        })
        expect(
            fake.calls.filter((request) => request.method === 'POST')
        ).toHaveLength(1)
    })

    it('returns unknown when an uncertain deletion remains visible', async () => {
        const stale = detail(post({ authorId: '10001', time: epochSeconds() }))
        const fake = createFakeFetch([
            stale,
            () => {
                throw new Error('connection reset')
            },
            stale,
            stale,
            stale
        ])

        const result = await createClient(fake.fetch).deleteOwnPost({
            post: ownReference()
        })

        expect(result).toEqual({
            outcome: 'unknown',
            reference: ownReference()
        })
        expect(
            fake.calls.filter((request) => request.method === 'POST')
        ).toHaveLength(1)
    })
})

function createClient(fetch: typeof globalThis.fetch): QzoneClient {
    return new QzoneClient({
        session: { cookies: 'uin=o10001; p_skey=secret' },
        fetch,
        requestTimeoutMs: 1_000
    })
}

function reference() {
    return { id: 'post-1', authorId: '20002' }
}

function ownReference() {
    return { id: 'post-1', authorId: '10001' }
}

interface PostFixtureOptions {
    readonly appId?: number
    readonly authorId?: string
    readonly liked?: boolean
    readonly time?: number
    readonly curkey?: string
    readonly unikey?: string
    readonly busiParam?: Readonly<Record<string, unknown>>
    readonly comments?: readonly Record<string, unknown>[]
}

function post(options: PostFixtureOptions = {}): Record<string, unknown> {
    return {
        appid: options.appId ?? 311,
        fid: 'post-1',
        hostuin: options.authorId ?? '20002',
        summary: 'post',
        ...(options.time === undefined ? {} : { time: options.time }),
        curkey: options.curkey ?? 'fallback-cur',
        unikey: options.unikey ?? 'fallback-uni',
        like: { isliked: options.liked ? 1 : 0, num: 1 },
        operation: { busi_param: options.busiParam ?? {} },
        comment: { comments: options.comments ?? [] }
    }
}

function comment(
    id: string,
    authorId: string,
    content: string,
    time: number
): Record<string, unknown> {
    return { commentid: id, uin: authorId, content, abstime: time }
}

function detail(value: Record<string, unknown>): Response {
    return jsonResponse({ data: value })
}

function profileHtml(page: Record<string, unknown>): string {
    return `<script>
        window.shine0callback = function () { return "def456"; };
        var FrontPage = { data: ${JSON.stringify([
            { data: { nickname: '用户' } },
            { data: page }
        ])} };
    </script>`
}

function epochSeconds(): number {
    return Math.floor(Date.now() / 1_000)
}
