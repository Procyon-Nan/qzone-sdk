import { describe, expect, it, vi } from 'vitest'

import {
    QzoneAuthError,
    QzoneCancelledError,
    QzoneClient,
    QzoneNotFoundError,
    QzoneParseError,
    QzoneRequestError,
    QzoneValidationError
} from '../../src/index.js'
import type { QzoneLogEvent, QzoneLogger } from '../../src/index.js'
import { createFakeFetch } from '../support/fake-fetch.js'
import { jsonResponse, textResponse } from '../support/fixtures.js'

describe('Feed operations', () => {
    it('reads the current-account index and continues through active feeds', async () => {
        const fake = createFakeFetch([
            (request) => {
                expect(request.url).toContain('/mqzone/index')
                return textResponse(
                    indexHtml(feedPage([post('self-1', '10001')], 'cursor-a'))
                )
            },
            (request) => {
                expect(request.url).toContain('/getActiveFeeds')
                expect(request.url).toContain('attach_info=cursor-a')
                expect(request.url).toContain('qzonetoken=abc123')
                return jsonResponse({
                    feedpage: feedPage([post('self-2', '10001')])
                })
            }
        ])
        const client = createClient(fake.fetch)

        const first = await client.listFeeds({ scope: 'self', limit: 1 })
        const second = await client.listFeeds({
            scope: 'self',
            limit: 1,
            cursor: requiredCursor(first.nextCursor)
        })

        expect(first.items.map((item) => item.id)).toEqual(['self-1'])
        expect(second.items.map((item) => item.id)).toEqual(['self-2'])
        expect(second.nextCursor).toBeNull()
        expect(fake.calls).toHaveLength(2)
    })

    it('falls back from an index home redirect to legacy recent feeds', async () => {
        const events: QzoneLogEvent[] = []
        const fake = createFakeFetch([
            textResponse('', {
                status: 302,
                headers: { location: 'https://user.qzone.qq.com/10001' }
            }),
            (request) => {
                expect(request.url).toContain('/feeds/feeds3_html_more')
                expect(request.url).toContain('pagenum=1')
                expect(request.url).toContain('outputhtmlfeed=1')
                return jsonResponse([
                    {
                        appid: 311,
                        key: 'friend-1',
                        opuin: '10002',
                        abstime: 1_710_000_000,
                        html: '<li><div class="f-info">好友动态</div></li>'
                    }
                ])
            }
        ])
        const client = createClient(fake.fetch, (event) => {
            events.push(event)
            if (event.phase === 'read.fallback') {
                throw new Error('logger failed')
            }
        })

        const page = await client.listFeeds({ scope: 'friends', limit: 2 })

        expect(page.items).toMatchObject([
            { id: 'friend-1', authorId: '10002', content: '好友动态' }
        ])
        expect(page.nextCursor).not.toBeNull()
        expect(fake.calls).toHaveLength(2)
        expect(events).toContainEqual({
            level: 'info',
            phase: 'read.fallback',
            endpoint: 'feed.index',
            fallbackEndpoint: 'feed.recent',
            statusCode: 302,
            errorCode: 'QZONE_REQUEST'
        })
        expect(events.some((event) => event.level === 'error')).toBe(false)
    })

    it('reports two successful self-feed fallbacks without error events', async () => {
        const events: QzoneLogEvent[] = []
        const homeRedirect = textResponse('', {
            status: 302,
            headers: { location: 'https://user.qzone.qq.com/10001' }
        })
        const fake = createFakeFetch([
            homeRedirect,
            homeRedirect,
            jsonResponse([
                {
                    appid: 311,
                    key: 'self-fallback',
                    opuin: '10001',
                    abstime: 1_710_000_000,
                    html: '<li><div class="f-info">回退动态</div></li>'
                }
            ])
        ])
        const client = createClient(fake.fetch, (event) => events.push(event))

        const page = await client.listFeeds({ scope: 'self', limit: 1 })

        expect(page.items[0]?.id).toBe('self-fallback')
        expect(
            events.filter((event) => event.phase === 'read.fallback')
        ).toEqual([
            expect.objectContaining({
                endpoint: 'feed.index',
                fallbackEndpoint: 'feed.legacy'
            }),
            expect.objectContaining({
                endpoint: 'feed.legacy',
                fallbackEndpoint: 'feed.recent'
            })
        ])
        expect(events.some((event) => event.level === 'error')).toBe(false)
    })

    it('keeps the final feed fallback failure visible', async () => {
        const events: QzoneLogEvent[] = []
        const fake = createFakeFetch([
            textResponse('', {
                status: 302,
                headers: { location: 'https://user.qzone.qq.com/10001' }
            }),
            textResponse('unavailable', { status: 503 }),
            textResponse('unavailable', { status: 503 }),
            textResponse('unavailable', { status: 503 })
        ])
        const client = createClient(fake.fetch, (event) => events.push(event))

        await expect(
            client.listFeeds({ scope: 'friends', limit: 1 })
        ).rejects.toMatchObject({
            code: 'QZONE_REQUEST',
            context: { statusCode: 503 }
        })

        expect(
            events.filter((event) => event.phase === 'read.fallback')
        ).toHaveLength(1)
        expect(events.at(-1)).toMatchObject({
            level: 'error',
            phase: 'request.error',
            endpoint: 'feed.recent',
            statusCode: 503,
            errorCode: 'QZONE_REQUEST'
        })
    })

    it('does not fall back from an index login redirect', async () => {
        const events: QzoneLogEvent[] = []
        const fake = createFakeFetch([
            textResponse('', {
                status: 302,
                headers: { location: 'https://ptlogin2.qq.com/login' }
            })
        ])
        const client = createClient(fake.fetch, (event) => events.push(event))

        await expect(
            client.listFeeds({ scope: 'friends', limit: 1 })
        ).rejects.toBeInstanceOf(QzoneAuthError)

        expect(fake.calls).toHaveLength(1)
        expect(events.some((event) => event.phase === 'read.fallback')).toBe(
            false
        )
        expect(events.at(-1)).toMatchObject({
            level: 'error',
            phase: 'request.error',
            endpoint: 'feed.index',
            errorCode: 'QZONE_AUTH'
        })
    })

    it('uses profile HTML and the target-bound modern cursor', async () => {
        const fake = createFakeFetch([
            (request) => {
                expect(request.url).toContain('/mqzone/profile')
                expect(request.url).toContain('hostuin=10002')
                return textResponse(
                    profileHtml(
                        feedPage([post('profile-1', '10002')], 'profile-cursor')
                    )
                )
            },
            (request) => {
                expect(request.url).toContain('mobile.qzone.qq.com/get_feeds')
                expect(request.url).toContain('hostuin=10002')
                expect(request.url).toContain('res_attach=profile-cursor')
                expect(request.url).toContain('qzonetoken=def456')
                return jsonResponse({
                    data: feedPage([post('profile-2', '10002')])
                })
            }
        ])
        const client = createClient(fake.fetch)

        const first = await client.listFeeds({
            scope: 'profile',
            userId: '10002',
            limit: 1
        })
        const second = await client.listFeeds({
            scope: 'profile',
            userId: '10002',
            limit: 1,
            cursor: requiredCursor(first.nextCursor)
        })

        expect(first.items[0]?.id).toBe('profile-1')
        expect(second.items[0]?.id).toBe('profile-2')
        expect(second.nextCursor).toBeNull()
    })

    it('stops a modern chain when the backend cursor repeats', async () => {
        const fake = createFakeFetch([
            textResponse(
                indexHtml(feedPage([post('post-1', '10001')], 'repeat'))
            ),
            jsonResponse({
                feedpage: feedPage([post('post-2', '10001')], 'repeat')
            })
        ])
        const client = createClient(fake.fetch)
        const first = await client.listFeeds({ scope: 'self', limit: 1 })

        const second = await client.listFeeds({
            scope: 'self',
            limit: 1,
            cursor: requiredCursor(first.nextCursor)
        })

        expect(second.items[0]?.id).toBe('post-2')
        expect(second.nextCursor).toBeNull()
        expect(fake.calls).toHaveLength(2)
    })

    it('merges a cached list post with the matching legacy detail only', async () => {
        const fake = createFakeFetch([
            textResponse(
                profileHtml(
                    feedPage([
                        {
                            ...post('target', '10002'),
                            nickname: '作者',
                            summary: '列表正文',
                            time: 1_690_000_000,
                            pic: [{ url3: 'https://m.qpic.cn/list.jpg' }]
                        }
                    ])
                )
            ),
            jsonResponse({
                data: [
                    post('neighbor', '10002'),
                    {
                        appid: 311,
                        fid: 'target',
                        hostuin: '10002',
                        summary: '详情正文',
                        comments: [
                            {
                                commentid: 'comment-1',
                                uin: '10003',
                                content: '评论'
                            }
                        ]
                    }
                ]
            })
        ])
        const client = createClient(fake.fetch)
        const listed = await client.listFeeds({
            scope: 'profile',
            userId: '10002',
            limit: 1
        })

        const detail = await client.getPost({ post: listed.items[0]! })

        expect(detail).toMatchObject({
            id: 'target',
            authorId: '10002',
            content: '详情正文',
            createdAt: '2023-07-22T04:26:40.000Z',
            media: [{ kind: 'image', url: 'https://m.qpic.cn/list.jpg' }],
            comments: [{ id: 'comment-1', content: '评论' }]
        })
        expect(detail.content).not.toContain('neighbor')
    })

    it('does not let a Feed preview overwrite complete detail comments', async () => {
        const now = Math.floor(Date.now() / 1_000)
        const rootComment = {
            tid: 'detail-comment',
            uin: '30003',
            content: 'detail comment',
            create_time: now,
            reply_num: 0
        }
        const fake = createFakeFetch([
            jsonResponse({
                data: [
                    {
                        ...post('target', '10002'),
                        cmtnum: 1,
                        commentlist: [rootComment]
                    }
                ]
            }),
            textResponse(
                profileHtml(
                    feedPage([
                        {
                            ...post('target', '10002'),
                            comment: {
                                num: 1,
                                comments: [
                                    {
                                        tid: 'preview-comment',
                                        uin: '30004',
                                        content: 'preview'
                                    }
                                ]
                            }
                        }
                    ])
                )
            ),
            async (request) => {
                expect(request.method).toBe('POST')
                const form = new URLSearchParams(await request.text())
                expect(form.get('commentId')).toBe('detail-comment')
                expect(form.get('commentUin')).toBe('30003')
                return jsonResponse({ data: { commentId: 'reply-new' } })
            },
            jsonResponse({
                data: [
                    {
                        ...post('target', '10002'),
                        cmtnum: 1,
                        commentlist: [
                            {
                                ...rootComment,
                                reply_num: 1,
                                list_3: [
                                    {
                                        tid: 'reply-new',
                                        uin: '10001',
                                        content: 'reply',
                                        create_time: now
                                    }
                                ]
                            }
                        ]
                    }
                ]
            })
        ])
        const client = createClient(fake.fetch)

        const detail = await client.getPost({
            post: { id: 'target', authorId: '10002' }
        })
        expect(detail.commentsComplete).toBe(true)

        await client.listFeeds({
            scope: 'profile',
            userId: '10002',
            limit: 1
        })
        const result = await client.reply({
            post: { id: 'target', authorId: '10002' },
            comment: { id: 'detail-comment', authorId: '30003' },
            content: 'reply'
        })

        expect(result).toMatchObject({
            outcome: 'verified',
            comment: {
                id: 'reply-new',
                kind: 'reply',
                threadRoot: { id: 'detail-comment', authorId: '30003' }
            }
        })
        expect(fake.calls).toHaveLength(4)
    })

    it('falls back to token-bound H5 detail after legacy detail is rejected', async () => {
        const events: QzoneLogEvent[] = []
        const fake = createFakeFetch([
            textResponse('forbidden', { status: 403 }),
            (request) => {
                expect(request.url).toContain('/mqzone/profile')
                return textResponse(profileHtml(feedPage([])))
            },
            (request) => {
                expect(request.url).toContain('/mqzone_detail/shuoshuo')
                expect(request.url).toContain('qzonetoken=def456')
                expect(request.url).toContain('cellid=target')
                return jsonResponse({
                    data: {
                        ...post('target', '10002'),
                        summary: 'H5 详情'
                    }
                })
            }
        ])
        const client = createClient(fake.fetch, (event) => events.push(event))

        const detail = await client.getPost({
            post: { id: 'target', authorId: '10002' }
        })

        expect(detail).toMatchObject({
            id: 'target',
            authorId: '10002',
            content: 'H5 详情'
        })
        expect(fake.calls).toHaveLength(3)
        expect(events).toContainEqual({
            level: 'info',
            phase: 'read.fallback',
            endpoint: 'post.detail.legacy',
            fallbackEndpoint: 'post.detail.h5',
            statusCode: 403,
            errorCode: 'QZONE_PERMISSION'
        })
        expect(events.some((event) => event.level === 'error')).toBe(false)
    })

    it('obtains the current account token from index before H5 detail', async () => {
        const fake = createFakeFetch([
            textResponse('forbidden', { status: 403 }),
            (request) => {
                expect(request.url).toContain('/mqzone/index')
                return textResponse(indexHtml(feedPage([])))
            },
            (request) => {
                expect(request.url).toContain('/mqzone_detail/shuoshuo')
                expect(request.url).toContain('qzonetoken=abc123')
                return jsonResponse({
                    data: {
                        ...post('self-target', '10001'),
                        summary: '自己的详情'
                    }
                })
            }
        ])
        const client = createClient(fake.fetch)

        const detail = await client.getPost({
            post: { id: 'self-target', authorId: '10001' }
        })

        expect(detail.content).toBe('自己的详情')
        expect(fake.calls).toHaveLength(3)
    })

    it.each([
        ['HTTP 404', textResponse('missing', { status: 404 }), 'statusCode'],
        [
            'service code -8',
            jsonResponse({ code: -8, message: 'missing' }),
            'serviceCode'
        ]
    ] as const)(
        'maps a legacy detail %s to QzoneNotFoundError',
        async (_label, response, contextKey) => {
            const fake = createFakeFetch([response])

            let failure: unknown
            try {
                await createClient(fake.fetch).getPost({
                    post: { id: 'target', authorId: '10002' }
                })
            } catch (error) {
                failure = error
            }

            expect(failure).toBeInstanceOf(QzoneNotFoundError)
            expect(failure).toBeInstanceOf(QzoneRequestError)
            expect(failure).toMatchObject({
                code: 'QZONE_NOT_FOUND',
                context: {
                    operation: 'post.detail',
                    [contextKey]: contextKey === 'statusCode' ? 404 : -8
                },
                cause: expect.any(QzoneRequestError)
            })
            expect((failure as QzoneNotFoundError).context).not.toHaveProperty(
                'responseSnippet'
            )
        }
    )

    it.each([
        ['HTTP 404', textResponse('missing', { status: 404 }), 'statusCode'],
        [
            'service code -8',
            jsonResponse({ code: -8, message: 'missing' }),
            'serviceCode'
        ]
    ] as const)(
        'maps an H5 detail %s to QzoneNotFoundError',
        async (_label, response, contextKey) => {
            const fake = createFakeFetch([
                textResponse(
                    profileHtml(
                        feedPage([{ ...post('target', '10002'), appid: 202 }])
                    )
                ),
                response
            ])
            const client = createClient(fake.fetch)
            const listed = await client.listFeeds({
                scope: 'profile',
                userId: '10002',
                limit: 1
            })

            await expect(
                client.getPost({ post: listed.items[0]! })
            ).rejects.toMatchObject({
                code: 'QZONE_NOT_FOUND',
                context: {
                    operation: 'post.detail',
                    [contextKey]: contextKey === 'statusCode' ? 404 : -8
                }
            })
        }
    )

    it('does not map a token-page HTTP 404 to post not found', async () => {
        const fake = createFakeFetch([
            textResponse('forbidden', { status: 403 }),
            textResponse('missing profile', { status: 404 })
        ])

        let failure: unknown
        try {
            await createClient(fake.fetch).getPost({
                post: { id: 'target', authorId: '10002' }
            })
        } catch (error) {
            failure = error
        }

        expect(failure).toBeInstanceOf(QzoneRequestError)
        expect(failure).not.toBeInstanceOf(QzoneNotFoundError)
        expect(failure).toMatchObject({ context: { statusCode: 404 } })
    })

    it('does not map authentication or cancellation failures to post not found', async () => {
        const auth = createFakeFetch([
            textResponse('unauthorized', { status: 401 })
        ])
        await expect(
            createClient(auth.fetch).getPost({
                post: { id: 'target', authorId: '10002' }
            })
        ).rejects.toBeInstanceOf(QzoneAuthError)

        const controller = new AbortController()
        controller.abort()
        const cancelled = createFakeFetch([])
        await expect(
            createClient(cancelled.fetch).getPost({
                post: { id: 'target', authorId: '10002' },
                signal: controller.signal
            })
        ).rejects.toBeInstanceOf(QzoneCancelledError)
    })

    it('does not map an H5 server failure to post not found', async () => {
        const fake = createFakeFetch([
            textResponse(
                profileHtml(
                    feedPage([{ ...post('target', '10002'), appid: 202 }])
                )
            ),
            textResponse('unavailable', { status: 503 }),
            textResponse('unavailable', { status: 503 }),
            textResponse('unavailable', { status: 503 })
        ])
        const client = createClient(fake.fetch)
        const listed = await client.listFeeds({
            scope: 'profile',
            userId: '10002',
            limit: 1
        })

        let failure: unknown
        try {
            await client.getPost({ post: listed.items[0]! })
        } catch (error) {
            failure = error
        }

        expect(failure).toBeInstanceOf(QzoneRequestError)
        expect(failure).not.toBeInstanceOf(QzoneNotFoundError)
        expect(failure).toMatchObject({ context: { statusCode: 503 } })
    })

    it('clears a cached post after an explicit not-found response', async () => {
        const fake = createFakeFetch([
            textResponse(
                profileHtml(
                    feedPage([{ ...post('target', '10002'), appid: 202 }])
                )
            ),
            textResponse('missing', { status: 404 }),
            (request) => {
                expect(request.url).toContain('/emotion_cgi_msgdetail_v6')
                return textResponse('missing', { status: 404 })
            },
            textResponse(profileHtml(feedPage([])))
        ])
        const client = createClient(fake.fetch)
        const listed = await client.listFeeds({
            scope: 'profile',
            userId: '10002',
            limit: 1
        })

        await expect(
            client.getPost({ post: listed.items[0]! })
        ).rejects.toBeInstanceOf(QzoneNotFoundError)
        await expect(
            client.like({ post: { id: 'target', authorId: '10002' } })
        ).rejects.toBeInstanceOf(QzoneNotFoundError)

        expect(fake.calls).toHaveLength(4)
        expect(
            fake.calls.filter((request) => request.method === 'POST')
        ).toHaveLength(0)
    })

    it('rejects invalid options and a detail response without the target', async () => {
        const unused = createFakeFetch([])
        const client = createClient(unused.fetch)

        await expect(
            client.listFeeds({ scope: 'self', limit: 21 })
        ).rejects.toBeInstanceOf(QzoneValidationError)
        await expect(
            client.listFeeds({ scope: 'profile', userId: 'invalid' })
        ).rejects.toBeInstanceOf(QzoneValidationError)

        const fake = createFakeFetch([
            jsonResponse({ data: [post('neighbor', '10002')] }),
            textResponse(profileHtml(feedPage([]))),
            jsonResponse({ data: [post('neighbor', '10002')] })
        ])
        await expect(
            createClient(fake.fetch).getPost({
                post: { id: 'target', authorId: '10002' }
            })
        ).rejects.toBeInstanceOf(QzoneParseError)
    })

    it('waits for an issued read before clearing instance state on close', async () => {
        let resolveRead!: (response: Response) => void
        const response = new Promise<Response>((resolve) => {
            resolveRead = resolve
        })
        const fake = createFakeFetch([() => response])
        const client = createClient(fake.fetch)
        const reading = client.listFeeds({ scope: 'self', limit: 1 })
        await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
        expect(() => client.clearSession()).toThrow(
            '存在正在执行的操作，无法清除 Session'
        )

        const closing = client.close()
        let closed = false
        void closing.then(() => {
            closed = true
        })
        await Promise.resolve()
        expect(closed).toBe(false)
        expect(client.getSessionInfo().accountId).toBe('10001')

        resolveRead(
            textResponse(indexHtml(feedPage([post('issued', '10001')])))
        )
        await expect(reading).resolves.toMatchObject({
            items: [{ id: 'issued' }]
        })
        await closing
        expect(client.getSessionInfo().accountId).toBeNull()
    })
})

function createClient(
    fetch: typeof globalThis.fetch,
    logger?: QzoneLogger
): QzoneClient {
    return new QzoneClient({
        session: {
            cookies: 'uin=o10001; p_skey=secret'
        },
        fetch,
        logger,
        requestTimeoutMs: 1_000
    })
}

function post(id: string, authorId: string): Record<string, unknown> {
    return {
        appid: 311,
        fid: id,
        hostuin: authorId,
        summary: `post ${id}`,
        time: 1_710_000_000
    }
}

function feedPage(
    items: readonly Record<string, unknown>[],
    cursor = ''
): Record<string, unknown> {
    return {
        vFeeds: items,
        attachinfo: cursor,
        hasmore: cursor ? 1 : 0
    }
}

function indexHtml(page: Record<string, unknown>): string {
    return frontPageHtml(JSON.stringify({ feedpage: page }), 'abc123')
}

function profileHtml(page: Record<string, unknown>): string {
    return frontPageHtml(
        JSON.stringify([{ data: { nickname: '用户' } }, { data: page }]),
        'def456'
    )
}

function frontPageHtml(data: string, token: string): string {
    return `<script>
        window.shine0callback = function () { return "${token}"; };
        var FrontPage = { data: ${data} };
    </script>`
}

function requiredCursor(value: string | null): string {
    expect(value).not.toBeNull()
    return value!
}
