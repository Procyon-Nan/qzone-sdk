import { describe, expect, it } from 'vitest'

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
                        ...post('matched', 'same'),
                        time: now
                    }
                ])
            )
        ])

        const result = await createClient(fake.fetch).publishPost({
            content: '  same\n'
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
