import { describe, expect, it, vi } from 'vitest'

import {
    QzoneClient,
    QzoneParseError,
    QzoneValidationError
} from '../../src/index.js'
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
        const client = createClient(fake.fetch)

        const page = await client.listFeeds({ scope: 'friends', limit: 2 })

        expect(page.items).toMatchObject([
            { id: 'friend-1', authorId: '10002', content: '好友动态' }
        ])
        expect(page.nextCursor).not.toBeNull()
        expect(fake.calls).toHaveLength(2)
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

    it('falls back to token-bound H5 detail after legacy detail is rejected', async () => {
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
        const client = createClient(fake.fetch)

        const detail = await client.getPost({
            post: { id: 'target', authorId: '10002' }
        })

        expect(detail).toMatchObject({
            id: 'target',
            authorId: '10002',
            content: 'H5 详情'
        })
        expect(fake.calls).toHaveLength(3)
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

function createClient(fetch: typeof globalThis.fetch): QzoneClient {
    return new QzoneClient({
        session: {
            cookies: 'uin=o10001; p_skey=secret'
        },
        fetch,
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
