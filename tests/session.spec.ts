import { describe, expect, it, vi } from 'vitest'

import { QzoneClient, QzoneValidationError } from '../src/index.js'
import { SessionState } from '../src/session/session.js'

const NOW = '2026-08-12T08:00:00.000Z'

describe('Session state', () => {
    it('constructs a credential-free info view and isolated snapshot', () => {
        const input = {
            accountId: '10001',
            cookies: { uin: 'o10001', p_skey: 'secret' },
            tokens: { '10001': 'token' },
            updatedAt: NOW
        }
        const client = new QzoneClient({ session: input })

        input.cookies.p_skey = 'changed'
        input.tokens['10001'] = 'changed'

        expect(client.getSessionInfo()).toEqual({
            accountId: '10001',
            authenticated: true,
            updatedAt: NOW,
            persistencePending: false
        })
        expect(client.exportSession()).toEqual({
            accountId: '10001',
            cookies: {
                uin: 'o10001',
                p_skey: 'secret',
                p_uin: 'o10001'
            },
            tokens: { '10001': 'token' },
            updatedAt: NOW
        })
    })

    it('rejects a declared account that conflicts with Cookie identity', () => {
        expect(
            () =>
                new QzoneClient({
                    session: {
                        accountId: '10002',
                        cookies: 'uin=o10001; p_skey=secret'
                    }
                })
        ).toThrow('Cookie 账号与声明账号不一致')
    })

    it('rejects updates for a different account without changing state', async () => {
        const client = createClient()

        await expect(
            client.updateSession({
                cookies: 'uin=o10002; p_skey=other'
            })
        ).rejects.toBeInstanceOf(QzoneValidationError)
        expect(client.exportSession().accountId).toBe('10001')
    })

    it('rejects account changes after credentials are cleared', async () => {
        const client = createClient()
        client.clearSession()

        await expect(
            client.updateSession({ cookies: 'uin=o10002; p_skey=other' })
        ).rejects.toThrow('不能将 Session 更新为其他账号')
    })

    it('applies updates atomically when validation fails', async () => {
        const client = createClient()
        const before = client.exportSession()

        await expect(
            client.updateSession({
                cookies: 'uin=o10001; p_skey=updated',
                updatedAt: 'invalid'
            })
        ).rejects.toThrow('Session 更新时间必须是有效时间')
        expect(client.exportSession()).toEqual(before)
    })

    it('notifies synchronous and asynchronous persistence handlers', async () => {
        const synchronous = vi.fn()
        const asynchronous = vi.fn(async () => undefined)
        const first = createClient(synchronous)
        const second = createClient(asynchronous)

        await first.updateSession({
            cookies: 'uin=o10001; p_skey=updated',
            updatedAt: NOW
        })
        await second.updateSession({
            cookies: 'uin=o10001; p_skey=updated',
            updatedAt: NOW
        })

        expect(synchronous).toHaveBeenCalledOnce()
        expect(asynchronous).toHaveBeenCalledOnce()
        expect(first.getSessionInfo().persistencePending).toBe(false)
        expect(second.getSessionInfo().persistencePending).toBe(false)
    })

    it('retains new state and marks persistence pending on callback failure', async () => {
        const cause = new Error('storage unavailable')
        const client = createClient(() => {
            throw cause
        })

        const update = client.updateSession({
            cookies: 'uin=o10001; p_skey=updated',
            updatedAt: NOW
        })

        await expect(update).rejects.toMatchObject({
            code: 'QZONE_REQUEST',
            cause,
            context: { operation: 'session.persist' }
        })
        expect(client.exportSession().cookies.p_skey).toBe('updated')
        expect(client.getSessionInfo().persistencePending).toBe(true)
    })

    it('clears persistence pending after a later successful callback', async () => {
        let fail = true
        const client = createClient(() => {
            if (fail) {
                throw new Error('storage unavailable')
            }
        })

        await expect(
            client.updateSession({
                cookies: 'uin=o10001; p_skey=first',
                updatedAt: NOW
            })
        ).rejects.toMatchObject({ code: 'QZONE_REQUEST' })
        fail = false
        await client.updateSession({
            cookies: 'uin=o10001; p_skey=second',
            updatedAt: NOW
        })

        expect(client.getSessionInfo().persistencePending).toBe(false)
    })

    it('does not persist an unchanged protocol token', async () => {
        const onSessionChange = vi.fn()
        const session = new SessionState(
            {
                cookies: 'uin=o10001; p_skey=secret',
                tokens: { '10001': 'token' }
            },
            { onSessionChange }
        )

        await session.setToken('10001', 'token')

        expect(onSessionChange).not.toHaveBeenCalled()
    })

    it('clears credentials and protocol tokens', () => {
        const client = createClient()

        client.clearSession()

        expect(client.getSessionInfo()).toEqual({
            accountId: null,
            authenticated: false,
            updatedAt: null,
            persistencePending: false
        })
        expect(() => client.exportSession()).toThrow('当前没有可导出的 Session')
    })
})

function createClient(
    onSessionChange?: (
        session: ReturnType<QzoneClient['exportSession']>
    ) => void | Promise<void>
): QzoneClient {
    return new QzoneClient({
        session: {
            accountId: '10001',
            cookies: 'uin=o10001; p_skey=secret',
            tokens: { '10001': 'token' },
            updatedAt: NOW
        },
        onSessionChange
    })
}
