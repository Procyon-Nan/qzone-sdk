import { describe, expect, it } from 'vitest'

import { computeGtk, hash33 } from '../../src/session/gtk.js'
import { parseCookies } from '../../src/session/cookies.js'

describe('g_tk', () => {
    it.each([
        ['', 5381],
        ['skey', 2090726337],
        ['@example-token', 1375897855],
        ['中文😀', 216157369]
    ])('matches the hash33 vector for %s', (secret, expected) => {
        expect(hash33(secret, 5381)).toBe(expected)
    })

    it('prefers p_skey over other secret and direct token fields', () => {
        const cookies = parseCookies({
            p_skey: 'primary',
            skey: 'secondary',
            g_tk: '123'
        })

        expect(computeGtk(cookies)).toBe(hash33('primary', 5381))
    })

    it.each(['gtk', 'bkn', 'csrf_token'])(
        'accepts the %s direct alias',
        (key) => {
            expect(computeGtk(parseCookies({ [key]: '123' }))).toBe(123)
        }
    )

    it('returns zero without a usable secret or direct token', () => {
        expect(computeGtk(parseCookies({ uin: 'o10001', g_tk: 'bad' }))).toBe(0)
    })
})
