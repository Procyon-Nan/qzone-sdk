import { describe, expect, it } from 'vitest'

import {
    QzoneAuthError,
    QzoneClient
} from '../../src/index.js'
import { createFakeFetch } from '../support/fake-fetch.js'
import { jsonResponse, textResponse } from '../support/fixtures.js'

function legacyAuthFailure(): Record<string, unknown> {
    return { code: -3000, message: '请先登录空间', subcode: 0 }
}

describe('mood endpoint auth diagnostics', () => {
    it('explains a missing p_skey cookie when mood endpoints reject the session', async () => {
        // 仅 skey 的会话：g_tk 由 skey 派生，说说类接口会被服务端以 -3000 拒绝。
        const fake = createFakeFetch([
            textResponse('', {
                status: 302,
                headers: { location: 'https://user.qzone.qq.com/10001' }
            }),
            jsonResponse(legacyAuthFailure())
        ])
        const client = new QzoneClient({
            session: { cookies: 'uin=o10001; skey=legacy-secret' },
            fetch: fake.fetch,
            requestTimeoutMs: 1_000
        })

        const info = client.getSessionInfo()
        expect(info.gtkSource).toBe('skey')

        const error = await client
            .listFeeds({ scope: 'self', limit: 1 })
            .then(
                () => null,
                (caught: unknown) => caught
            )

        expect(error).toBeInstanceOf(QzoneAuthError)
        const authError = error as QzoneAuthError
        expect(authError.message).toContain('p_skey')
        expect(authError.context?.hint).toContain('p_skey')
        expect(authError.context?.serviceCode).toBe(-3000)
    })

    it('keeps the original message when the session has p_skey', async () => {
        const fake = createFakeFetch([
            textResponse('', {
                status: 302,
                headers: { location: 'https://user.qzone.qq.com/10001' }
            }),
            jsonResponse(legacyAuthFailure())
        ])
        const client = new QzoneClient({
            session: { cookies: 'uin=o10001; p_skey=secret' },
            fetch: fake.fetch,
            requestTimeoutMs: 1_000
        })

        expect(client.getSessionInfo().gtkSource).toBe('p_skey')

        const error = await client
            .listFeeds({ scope: 'self', limit: 1 })
            .then(
                () => null,
                (caught: unknown) => caught
            )

        expect(error).toBeInstanceOf(QzoneAuthError)
        expect((error as QzoneAuthError).message).toBe('请先登录空间')
        expect((error as QzoneAuthError).context?.hint).toBeUndefined()
    })

    it('reports the g_tk source in session info', () => {
        const withPSkey = new QzoneClient({
            session: { cookies: 'uin=o10001; skey=a; p_skey=b' }
        })
        expect(withPSkey.getSessionInfo().gtkSource).toBe('p_skey')

        const withSkeyOnly = new QzoneClient({
            session: { cookies: 'uin=o10001; skey=a' }
        })
        expect(withSkeyOnly.getSessionInfo().gtkSource).toBe('skey')

        const credentialFree = new QzoneClient({
            session: { cookies: 'uin=o10001' }
        })
        const info = credentialFree.getSessionInfo()
        expect(info.gtkSource).toBe('none')
        expect(info.authenticated).toBe(false)
    })
})
