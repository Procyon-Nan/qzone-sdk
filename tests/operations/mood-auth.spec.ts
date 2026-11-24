import { describe, expect, it } from 'vitest'

import { QzoneAuthError, QzoneClient } from '../../src/index.js'
import { QzoneReadApi } from '../../src/operations/read.js'
import { SessionState } from '../../src/session/session.js'
import { FetchTransport } from '../../src/transport/fetch-transport.js'
import { createFakeFetch } from '../support/fake-fetch.js'
import { jsonResponse, textResponse } from '../support/fixtures.js'

describe('mood endpoint auth diagnostics', () => {
    it.each(['feeds', 'detail'] as const)(
        'adds a missing-cookie hint only without p_skey: %s',
        async (operation) => {
            for (const credential of ['skey', 'p_skey']) {
                const fake = createFakeFetch([
                    ...(operation === 'feeds'
                        ? [
                              textResponse('', {
                                  status: 302,
                                  headers: {
                                      location:
                                          'https://user.qzone.qq.com/10001'
                                  }
                              })
                          ]
                        : []),
                    jsonResponse({ code: -3000, message: '请先登录空间' })
                ])
                const client = new QzoneClient({
                    session: {
                        cookies: `uin=o10001; ${credential}=private-secret`
                    },
                    fetch: fake.fetch
                })
                const request =
                    operation === 'feeds'
                        ? client.listFeeds({ scope: 'self', limit: 1 })
                        : client.getPost({
                              post: { id: 'post', authorId: '10001' }
                          })
                const error = await request.catch((caught: unknown) => caught)
                expect(error).toBeInstanceOf(QzoneAuthError)
                const authError = error as QzoneAuthError
                expect(authError.message).toContain('请先登录空间')
                expect(authError.context).toMatchObject({
                    endpoint:
                        operation === 'feeds'
                            ? 'feed.legacy'
                            : 'post.detail.legacy',
                    serviceCode: -3000
                })
                if (credential === 'skey') {
                    expect(authError.message).toContain('p_skey')
                    expect(authError.context?.hint).toContain('p_skey')
                    expect(authError.cause).toMatchObject({
                        message: '请先登录空间'
                    })
                } else {
                    expect(authError.message).toBe('请先登录空间')
                    expect(authError.context?.hint).toBeUndefined()
                }
                expect(JSON.stringify(authError)).not.toContain(
                    'private-secret'
                )
                expect(fake.calls).toHaveLength(operation === 'feeds' ? 2 : 1)
                await client.close()
            }
        }
    )

    it.each([
        {
            operation: 'legacy',
            response: textResponse('', { status: 401 }),
            message: 'QQ 空间登录态已失效'
        },
        {
            operation: 'legacy',
            response: jsonResponse({ code: -123, message: 'session expired' }),
            message: 'session expired'
        },
        {
            operation: 'active',
            response: jsonResponse({ code: -3000, message: '请先登录空间' }),
            message: '请先登录空间'
        }
    ])(
        'preserves other auth errors: $operation / $message',
        async ({ operation, response, message }) => {
            const fake = createFakeFetch([response])
            const session = new SessionState({
                cookies: 'uin=o10001; skey=secret',
                tokens: { '10001': 'token' }
            })
            const read = new QzoneReadApi(
                session,
                new FetchTransport({ session, fetch: fake.fetch })
            )
            const request =
                operation === 'active'
                    ? read.active('10001', 'cursor')
                    : read.legacyDetail('10001', 'post')
            const error = await request.catch((caught: unknown) => caught)
            expect(error).toBeInstanceOf(QzoneAuthError)
            expect((error as QzoneAuthError).message).toBe(message)
            expect((error as QzoneAuthError).context?.hint).toBeUndefined()
            expect(fake.calls).toHaveLength(1)
        }
    )

    it('preserves the missing qzonetoken error before any request', async () => {
        const fake = createFakeFetch([])
        const session = new SessionState({ cookies: 'uin=o10001; skey=secret' })
        const read = new QzoneReadApi(
            session,
            new FetchTransport({ session, fetch: fake.fetch })
        )
        await expect(read.active('10001', 'cursor')).rejects.toThrow(
            'QQ 空间请求缺少 qzonetoken'
        )
        expect(fake.calls).toHaveLength(0)
    })
})
