import { describe, expect, it, vi } from 'vitest'

import {
    QzoneClient,
    QzoneRequestError,
    QzoneValidationError
} from '../../src/index.js'
import { createFakeFetch } from '../support/fake-fetch.js'
import { jsonResponse, textResponse } from '../support/fixtures.js'

describe('publish operations', () => {
    it('publishes unchanged text and verifies the returned post ID', async () => {
        const fake = createFakeFetch([
            async (request) => {
                expect(request.url).toContain('/emotion_cgi_publish_v6')
                expect(request.url).toMatch(/[?&]g_tk=\d+/u)
                expect(request.headers.get('origin')).toBe(
                    'https://user.qzone.qq.com'
                )
                const form = new URLSearchParams(await request.text())
                expect(form.get('con')).toBe('  原样正文\n')
                expect(form.get('hostuin')).toBe('10001')
                expect(form.get('richval')).toBe('')
                expect(form.has('richtype')).toBe(false)
                return jsonResponse({ code: 0, data: { fid: 'new-1' } })
            },
            jsonResponse({ data: post('new-1', '  原样正文\n') })
        ])

        const result = await createClient(fake.fetch).publishPost({
            content: '  原样正文\n'
        })

        expect(result).toMatchObject({
            outcome: 'verified',
            post: { id: 'new-1' }
        })
        expect(fake.calls).toHaveLength(2)
    })

    it('copies, uploads, and publishes images using the confirmed form contract', async () => {
        const bytes = png(16, 17)
        const originalBase64 = bytesToBase64(bytes)
        const fake = createFakeFetch([
            async (request) => {
                expect(request.url).toContain('/cgi_upload_image')
                expect(request.url).toMatch(/[?&]g_tk=\d+/u)
                const form = new URLSearchParams(await request.text())
                expect(form.get('filename')).toBe('photo.png')
                expect(form.get('uin')).toBe('10001')
                expect(form.get('skey')).toBe('secret')
                expect(form.get('p_skey')).toBe('secret')
                expect(form.get('qzonetoken')).toBe('token')
                expect(form.get('picfile')).toBe(originalBase64)
                return jsonResponse({
                    code: 0,
                    data: {
                        albumid: 'album',
                        lloc: 'large',
                        sloc: 'small',
                        type: 3,
                        height: 17,
                        width: 16,
                        url: 'https://m.qpic.cn/a?bo=encoded%2Fvalue'
                    }
                })
            },
            async (request) => {
                const form = new URLSearchParams(await request.text())
                expect(form.get('con')).toBe('')
                expect(form.get('richtype')).toBe('1')
                expect(form.get('subrichtype')).toBe('1')
                expect(form.get('pic_bo')).toBe('encoded/value')
                expect(form.get('richval')).toBe(
                    ',album,large,small,3,17,16,,17,16'
                )
                return jsonResponse({ data: { tid: 'image-1' } })
            },
            jsonResponse({ data: post('image-1', '', 1) })
        ])

        const resultPromise = createClient(fake.fetch).publishPost({
            images: [{ data: bytes, name: 'photo.png' }]
        })
        bytes[23] = 99
        const result = await resultPromise

        expect(result.outcome).toBe('verified')
        expect(fake.calls).toHaveLength(3)
    })

    it('limits parallel uploads to five while preserving image order', async () => {
        let active = 0
        let maximum = 0
        let sequence = 0
        const uploads = Array.from({ length: 9 }, () => async () => {
            const current = sequence
            sequence += 1
            active += 1
            maximum = Math.max(maximum, active)
            await new Promise((resolve) => setTimeout(resolve, 5))
            active -= 1
            return jsonResponse({
                data: {
                    albumid: `a${current}`,
                    lloc: `l${current}`,
                    sloc: `s${current}`,
                    type: 3,
                    height: 16,
                    width: 16
                }
            })
        })
        const fake = createFakeFetch([
            ...uploads,
            async (request) => {
                const richval = new URLSearchParams(await request.text()).get(
                    'richval'
                )
                expect(richval?.split('\t')).toHaveLength(9)
                expect(richval).toContain(',a0,l0,s0,')
                expect(richval).toContain(',a8,l8,s8,')
                return jsonResponse({ data: { fid: 'nine' } })
            },
            jsonResponse({ data: post('nine', 'nine', 9) })
        ])

        const result = await createClient(fake.fetch).publishPost({
            content: 'nine',
            images: Array.from({ length: 9 }, (_, index) => ({
                data: png(16, 16),
                name: `${index}.png`
            }))
        })

        expect(result.outcome).toBe('verified')
        expect(maximum).toBe(5)
    })

    it('does not send the final publish request after an upload failure', async () => {
        const fake = createFakeFetch([textResponse('failed', { status: 500 })])

        await expect(
            createClient(fake.fetch).publishPost({
                images: [{ data: png(16, 16), name: 'a.png' }]
            })
        ).rejects.toBeInstanceOf(QzoneRequestError)
        expect(fake.calls).toHaveLength(1)
        expect(fake.calls[0]?.url).toContain('/cgi_upload_image')
    })

    it('rejects empty input, invalid images, and more than nine images locally', async () => {
        const fake = createFakeFetch([])
        const client = createClient(fake.fetch)

        await expect(client.publishPost({})).rejects.toBeInstanceOf(
            QzoneValidationError
        )
        await expect(
            client.publishPost({
                images: [
                    {
                        data: new TextEncoder().encode('not-image'),
                        name: 'fake.png'
                    }
                ]
            })
        ).rejects.toBeInstanceOf(QzoneValidationError)
        await expect(
            client.publishPost({
                images: Array.from({ length: 10 }, (_, index) => ({
                    data: png(16, 16),
                    name: `${index}.png`
                }))
            })
        ).rejects.toBeInstanceOf(QzoneValidationError)
        expect(fake.calls).toHaveLength(0)
    })

    it('verifies a unique no-ID response by author, time, content, and media count', async () => {
        const now = Math.floor(Date.now() / 1_000)
        const fake = createFakeFetch([
            jsonResponse({ code: 0, data: { message: 'accepted' } }),
            textResponse(
                indexHtml([
                    {
                        ...post('matched', 'same text\n\nnext line'),
                        time: now
                    }
                ])
            )
        ])

        const result = await createClient(fake.fetch).publishPost({
            content: '  same  text\r\n\r\n\r\n next\tline\n'
        })

        expect(result).toMatchObject({
            outcome: 'verified',
            message: 'accepted',
            post: { id: 'matched' }
        })
    })

    it('returns accepted when a successful no-ID response has no unique match', async () => {
        const now = Math.floor(Date.now() / 1_000)
        const fake = createFakeFetch([
            jsonResponse({ code: 0, data: {} }),
            textResponse(
                indexHtml([
                    { ...post('one', 'duplicate'), time: now },
                    { ...post('two', 'duplicate'), time: now }
                ])
            )
        ])

        const result = await createClient(fake.fetch).publishPost({
            content: 'duplicate'
        })

        expect(result).toEqual({ outcome: 'accepted' })
    })

    it('keeps the returned reference when an accepted post is not yet readable', async () => {
        const fake = createFakeFetch([
            jsonResponse({ code: 0, data: { fid: 'pending-id' } }),
            textResponse('not ready', { status: 404 })
        ])

        const result = await createClient(fake.fetch).publishPost({
            content: 'pending'
        })

        expect(result).toEqual({
            outcome: 'accepted',
            reference: { id: 'pending-id', authorId: '10001' }
        })
    })

    it('returns verified or unknown after an uncertain final request', async () => {
        const now = Math.floor(Date.now() / 1_000)
        const verifiedFetch = createFakeFetch([
            () => {
                throw new Error('connection reset')
            },
            textResponse(
                indexHtml([{ ...post('found', 'uncertain'), time: now }])
            )
        ])
        const unknownFetch = createFakeFetch([
            () => {
                throw new Error('connection reset')
            },
            textResponse(indexHtml([]))
        ])

        await expect(
            createClient(verifiedFetch.fetch).publishPost({
                content: 'uncertain'
            })
        ).resolves.toMatchObject({
            outcome: 'verified',
            post: { id: 'found' }
        })
        await expect(
            createClient(unknownFetch.fetch).publishPost({
                content: 'missing'
            })
        ).resolves.toEqual({ outcome: 'unknown' })
    })

    it('continues read-only verification when cancellation occurs after sending', async () => {
        const controller = new AbortController()
        const now = Math.floor(Date.now() / 1_000)
        const fake = createFakeFetch([
            () => {
                controller.abort()
                return new Promise<Response>(() => undefined)
            },
            textResponse(
                indexHtml([{ ...post('cancelled', 'sent'), time: now }])
            )
        ])

        await expect(
            createClient(fake.fetch).publishPost({
                content: 'sent',
                signal: controller.signal
            })
        ).resolves.toMatchObject({
            outcome: 'verified',
            post: { id: 'cancelled' }
        })
        expect(fake.calls).toHaveLength(2)
    })

    it('waits for the active write while closing and cancels queued writes', async () => {
        let resolveWrite!: (response: Response) => void
        const stalledWrite = new Promise<Response>((resolve) => {
            resolveWrite = resolve
        })
        const fake = createFakeFetch([
            () => stalledWrite,
            textResponse(indexHtml([])),
            jsonResponse({ data: post('active', 'active') })
        ])
        const client = createClient(fake.fetch)
        const active = client.publishPost({ content: 'active' })
        await vi.waitFor(() => expect(fake.calls).toHaveLength(1))
        await expect(
            client.listFeeds({ scope: 'self', limit: 1 })
        ).resolves.toMatchObject({ items: [] })
        expect(fake.calls).toHaveLength(2)
        expect(() => client.clearSession()).toThrow(
            '存在正在执行的操作，无法清除 Session'
        )

        const queued = client.publishPost({ content: 'queued' })
        const queuedCancelled = expect(queued).rejects.toMatchObject({
            code: 'QZONE_CANCELLED',
            context: { operation: 'client.close' }
        })
        const closing = client.close()

        expect(client.close()).toBe(closing)
        await queuedCancelled
        await expect(
            client.listFeeds({ scope: 'self', limit: 1 })
        ).rejects.toMatchObject({
            code: 'QZONE_VALIDATION',
            context: { operation: 'client.closed' }
        })
        await expect(
            client.publishPost({ content: 'after-close' })
        ).rejects.toMatchObject({
            code: 'QZONE_VALIDATION',
            context: { operation: 'client.closed' }
        })
        await expect(
            client.updateSession({
                cookies: 'uin=o10001; p_skey=updated'
            })
        ).rejects.toMatchObject({
            code: 'QZONE_VALIDATION',
            context: { operation: 'client.closed' }
        })
        expect(() => client.clearSession()).toThrow('QzoneClient 已关闭')
        expect(client.getSessionInfo().accountId).toBe('10001')

        resolveWrite(jsonResponse({ data: { fid: 'active' } }))
        await expect(active).resolves.toMatchObject({
            outcome: 'verified',
            post: { id: 'active' }
        })
        await closing

        expect(client.getSessionInfo()).toEqual({
            accountId: null,
            authenticated: false,
            updatedAt: null,
            persistencePending: false
        })
        expect(() => client.exportSession()).toThrow('当前没有可导出的 Session')
        expect(fake.calls).toHaveLength(3)
    })
})

describe('video publishing', () => {
    const clip = () => ({
        name: 'clip.mp4',
        data: new Uint8Array([
            0, 0, 0, 16, 102, 116, 121, 112, 105, 115, 111, 109, 0, 0, 0, 0
        ])
    })
    function upload(id: string) {
        return [
            jsonResponse({ data: { session: 'upload', slice_size: 8 } }),
            async (req: Request) => {
                const parts = await req.formData()
                expect(req.url).toContain('offset=0')
                expect(await (parts.get('data') as Blob).arrayBuffer()).toEqual(
                    clip().data.slice(0, 8).buffer
                )
                return jsonResponse({ ret: 0 })
            },
            async (req: Request) => {
                expect(req.url).toContain('offset=8')
                return jsonResponse({ data: { biz: { sVid: id } } })
            }
        ]
    }
    const imageReply = (id: string) =>
        jsonResponse({
            data: {
                albumid: 'album',
                lloc: id,
                sloc: id,
                type: 3,
                height: 16,
                width: 16
            }
        })
    const videoRecord = (vid: string) => ({
        video_info: {
            vid,
            url3: 'https://cache.tv.qq.com/qqplayerout.swf?v=' + vid,
            url1: 'https://m.qpic.cn/' + vid + '.jpg'
        }
    })
    it.each([
        [
            '空白格式',
            '  正文🌙  图片\t视频\r\n\r\n\r\n 下一段\n',
            '正文🌙 图片 视频<br><br>下一段',
            'verified'
        ],
        ['文字变更', '正文  图片', '正文 视频', 'accepted'],
        ['换行不同', '正文\n图片', '正文 图片', 'accepted'],
        [
            '保留字面标签和实体',
            '<b>正文</b>  &amp;',
            '&lt;b&gt;正文&lt;/b&gt; &amp;amp;',
            'verified'
        ],
        ['标签丢失', '<b>正文</b>', '正文', 'accepted'],
        ['实体丢失', '&amp;', '&amp;', 'accepted']
    ])(
        'compares parsed text without rewriting the publish body: %s',
        async (_name, content, readback, outcome) => {
            const fake = createFakeFetch([
                ...upload('v1'),
                async (request) => {
                    expect(
                        new URLSearchParams(await request.text()).get('con')
                    ).toBe(content)
                    return jsonResponse({ tid: 'formatted' })
                },
                jsonResponse({
                    ...post('formatted', readback),
                    pic: [videoRecord('v1')]
                })
            ])
            const result = await createClient(fake.fetch).publishPost({
                content,
                videos: [clip()]
            })
            expect(result.outcome).toBe(outcome)
            expect(fake.calls).toHaveLength(5)
            expect(
                fake.calls.filter((request) =>
                    request.url.includes('emotion_cgi_publish')
                )
            ).toHaveLength(1)
        }
    )

    it.each([
        'complete',
        'missing-video',
        'missing-photo',
        'wrong-author',
        'wrong-content',
        'duplicate-id',
        'swapped-player'
    ])(
        'verifies detail identity and media without resolving playback: %s',
        async (scenario) => {
            const firstVideo = videoRecord('v1')
            const secondVideo = videoRecord(
                scenario === 'duplicate-id' ? 'v1' : 'v2'
            )
            if (scenario === 'swapped-player') {
                ;[firstVideo.video_info.url3, secondVideo.video_info.url3] = [
                    secondVideo.video_info.url3,
                    firstVideo.video_info.url3
                ]
            }
            const pic = [
                { url3: 'https://m.qpic.cn/photoA.jpg' },
                { url3: 'https://m.qpic.cn/photoB.jpg' },
                firstVideo,
                secondVideo
            ]
            if (scenario === 'missing-video') pic.pop()
            if (scenario === 'missing-photo') pic.shift()
            const fake = createFakeFetch([
                ...upload('v1'),
                ...upload('v2'),
                imageReply('a'),
                imageReply('b'),
                async (req) => {
                    const form = new URLSearchParams(await req.text())
                    expect(form.get('richtype')).toBe('1\n3\n3')
                    expect(form.get('subrichtype')).toBe('1\n7\n7')
                    const [photos, ...videos] = form.get('richval')!.split('\n')
                    expect(
                        photos!.split('\t').map((x) => x.split(',')[2])
                    ).toEqual(['a', 'b'])
                    expect(
                        videos.map((x) => new URLSearchParams(x).get('vid'))
                    ).toEqual(['v1', 'v2'])
                    return jsonResponse({ data: { tid: 'post' } })
                },
                jsonResponse({
                    ...post(
                        'post',
                        scenario === 'wrong-content' ? 'other' : 'caption'
                    ),
                    hostuin: scenario === 'wrong-author' ? '10002' : '10001',
                    pic
                })
            ])
            const first = clip()
            const promise = createClient(fake.fetch).publishPost({
                content: 'caption',
                images: ['a', 'b'].map((name) => ({ name, data: png(16, 16) })),
                videos: [first, clip()]
            })
            first.data.fill(0)
            const result = await promise
            expect(result.outcome).toBe(
                scenario === 'complete' ? 'verified' : 'accepted'
            )
            expect(
                fake.calls.filter((r) => r.url.includes('emotion_cgi_publish'))
            ).toHaveLength(1)
            expect(
                fake.calls.filter((r) => r.url.includes('video_get_data'))
            ).toHaveLength(0)
            if (scenario === 'complete')
                expect(result.post).toMatchObject({
                    id: 'post',
                    media: [{ kind: 'image' }, { kind: 'image' }]
                })
            else
                expect(result.reference).toEqual({
                    id: 'post',
                    authorId: '10001'
                })
        }
    )

    it('verifies video IDs without a player or media URL in the detail', async () => {
        const fake = createFakeFetch([
            ...upload('v1'),
            ...upload('v2'),
            jsonResponse({ tid: 'p' }),
            jsonResponse({
                ...post('p', 'caption'),
                pic: ['v1', 'v2'].map((vid) => ({
                    is_video: 1,
                    video_info: {
                        vid,
                        url1: 'https://m.qpic.cn/' + vid + '.jpg',
                        url3: ''
                    }
                }))
            })
        ])
        expect(
            await createClient(fake.fetch).publishPost({
                content: 'caption',
                videos: [clip(), clip()]
            })
        ).toMatchObject({ outcome: 'verified', post: { id: 'p', media: [] } })
        expect(fake.calls).toHaveLength(8)
    })

    it('verifies only the detail response and preserves list data for later reads', async () => {
        const video = [{ video_id: 'v1', url3: 'https://example.test/1.mp4' }]
        const reference = { id: 'p', authorId: '10001' }
        const detail = { fid: 'p', hostuin: '10001' }
        const fake = createFakeFetch([
            textResponse(indexHtml([{ ...post('p', 'caption'), video }])),
            ...upload('v1'),
            jsonResponse({ tid: 'p' }),
            jsonResponse(detail),
            jsonResponse(detail)
        ])
        const client = createClient(fake.fetch)
        await client.listFeeds({ scope: 'friends', limit: 1 })
        expect(
            await client.publishPost({ content: 'caption', videos: [clip()] })
        ).toMatchObject({ outcome: 'accepted', reference })
        expect(await client.getPost({ post: reference })).toMatchObject({
            content: 'caption',
            media: [{ id: 'v1' }]
        })
    })

    it('requires an author in the detail to verify an uploaded video', async () => {
        const fake = createFakeFetch([
            ...upload('v1'),
            jsonResponse({ tid: 'p' }),
            jsonResponse({
                fid: 'p',
                video: [{ video_id: 'v1', url3: 'https://example.test/1.mp4' }]
            })
        ])
        expect(
            await createClient(fake.fetch).publishPost({ videos: [clip()] })
        ).toMatchObject({
            outcome: 'accepted',
            reference: { id: 'p', authorId: '10001' }
        })
    })

    it('omits player URLs from lists and resolves a detail from shared index pages', async () => {
        const row = {
            ...post('p', 'caption'),
            pic: [
                {
                    videoflag: 0,
                    videodata: { videoid: '' },
                    url3: 'https://m.qpic.cn/photo.png'
                },
                videoRecord('wanted')
            ]
        }
        const fake = createFakeFetch([
            textResponse(indexHtml([row])),
            jsonResponse(row),
            jsonResponse({
                data: {
                    Videos: Array.from({ length: 50 }, (_, i) => ({
                        vid: String(i),
                        url: 'https://example.test/wrong.mp4'
                    }))
                }
            }),
            async (req) => {
                expect(new URL(req.url).searchParams.get('start')).toBe('50')
                return jsonResponse({
                    data: {
                        Videos: [
                            {
                                vid: 'wanted',
                                url: 'https://example.test/found.mp4'
                            }
                        ]
                    }
                })
            }
        ])
        const client = createClient(fake.fetch)
        const page = await client.listFeeds({ scope: 'friends', limit: 1 })
        expect(page.items[0]?.media.map((m) => m.kind)).toEqual(['image'])
        expect(fake.calls).toHaveLength(1)
        const detail = await client.getPost({
            post: { id: 'p', authorId: '10001' }
        })
        expect(detail.media.map((m) => m.url)).toEqual([
            'https://m.qpic.cn/photo.png',
            'https://example.test/found.mp4'
        ])
    })
    it('validates the whole batch before any upload and stops on slice failure', async () => {
        const invalid = createFakeFetch([])
        await expect(
            createClient(invalid.fetch).publishPost({
                videos: [clip(), { name: 'bad.mp4', data: new Uint8Array(8) }]
            })
        ).rejects.toBeInstanceOf(QzoneValidationError)
        expect(invalid.calls).toHaveLength(0)
        const failed = createFakeFetch([
            jsonResponse({ data: { session: 's', slice_size: 20 } }),
            jsonResponse({ ret: -5 })
        ])
        await expect(
            createClient(failed.fetch).publishPost({ videos: [clip()] })
        ).rejects.toBeInstanceOf(QzoneRequestError)
        expect(failed.calls).toHaveLength(2)
    })
    it('cancels between slices without submitting the post', async () => {
        const abort = new AbortController()
        const fake = createFakeFetch([
            jsonResponse({ data: { session: 's', slice_size: 8 } }),
            async () => {
                abort.abort()
                return jsonResponse({ ret: 0 })
            }
        ])
        await expect(
            createClient(fake.fetch).publishPost({
                videos: [clip()],
                signal: abort.signal
            })
        ).rejects.toThrow()
        expect(fake.calls).toHaveLength(2)
    })
    it('publishes a video alone, keeps direct links and does not repeat an uncertain submit', async () => {
        const ok = createFakeFetch([
            ...upload('v1'),
            async (r) => {
                expect(
                    new URLSearchParams(await r.text()).get('richtype')
                ).toBe('3')
                return jsonResponse({ tid: 'p' })
            },
            jsonResponse({
                ...post('p', ''),
                video: [{ video_id: 'v1', url3: 'https://example.test/1.mp4' }]
            })
        ])
        expect(
            (await createClient(ok.fetch).publishPost({ videos: [clip()] }))
                .outcome
        ).toBe('verified')
        expect(ok.calls).toHaveLength(5)
        const uncertain = createFakeFetch([
            ...upload('v1'),
            textResponse('lost', { status: 502 }),
            textResponse(indexHtml([]))
        ])
        expect(
            (
                await createClient(uncertain.fetch).publishPost({
                    videos: [clip()]
                })
            ).outcome
        ).toBe('unknown')
        expect(
            uncertain.calls.filter((r) => r.url.includes('emotion_cgi_publish'))
        ).toHaveLength(1)
    })
})

function createClient(fetch: typeof globalThis.fetch): QzoneClient {
    return new QzoneClient({
        session: {
            cookies: 'uin=o10001; p_skey=secret',
            tokens: { '10001': 'token' }
        },
        fetch,
        requestTimeoutMs: 1_000
    })
}

function post(
    id: string,
    content: string,
    imageCount = 0
): Record<string, unknown> {
    return {
        appid: 311,
        fid: id,
        hostuin: '10001',
        summary: content,
        time: Math.floor(Date.now() / 1_000),
        pic: Array.from({ length: imageCount }, (_, index) => ({
            url3: `https://m.qpic.cn/${id}-${index}.png`
        }))
    }
}

function indexHtml(items: readonly Record<string, unknown>[]): string {
    return `<script>
        window.shine0callback = function () { return "abc123"; };
        var FrontPage = { data: ${JSON.stringify({
            feedpage: { vFeeds: items, hasmore: 0 }
        })} };
    </script>`
}

function png(width: number, height: number): Uint8Array {
    const data = new Uint8Array(24)
    data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    data.set(new TextEncoder().encode('IHDR'), 12)
    const view = new DataView(data.buffer)
    view.setUint32(16, width)
    view.setUint32(20, height)
    return data
}

function bytesToBase64(data: Uint8Array): string {
    return btoa(String.fromCharCode(...data))
}
