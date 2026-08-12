import { describe, expect, it } from 'vitest'

import { QzoneValidationError } from '../../src/index.js'
import {
    mergeCookies,
    parseAccountId,
    parseCookies,
    serializeCookies
} from '../../src/session/cookies.js'

describe('Cookie parsing', () => {
    it.each([
        ['uin=o10001; p_skey=secret', { uin: 'o10001', p_skey: 'secret' }],
        [
            'Cookie: uin=o10001; p_skey=secret',
            { uin: 'o10001', p_skey: 'secret' }
        ],
        ['uin=o10001\np_skey=secret', { uin: 'o10001', p_skey: 'secret' }],
        [
            '{"uin":"o10001","p_skey":"secret"}',
            { uin: 'o10001', p_skey: 'secret' }
        ]
    ])('parses supported input %s', (input, expected) => {
        expect(Object.fromEntries(parseCookies(input))).toMatchObject(expected)
    })

    it('preserves equals signs and uses the last duplicate value', () => {
        const cookies = parseCookies('uin=o10001; token=a=b=c; token=latest')

        expect(cookies.get('token')).toBe('latest')
    })

    it('ignores empty and malformed fields', () => {
        const cookies = parseCookies(' ; invalid; empty=; uin=o10001')

        expect(Object.fromEntries(cookies)).toEqual({
            uin: 'o10001',
            p_uin: 'o10001'
        })
    })

    it('normalizes aliases and complementary UIN fields', () => {
        const cookies = parseCookies({
            pskey: 'secret',
            gtk: '123',
            p_uin: 'o10001'
        })

        expect(Object.fromEntries(cookies)).toEqual({
            pskey: 'secret',
            p_skey: 'secret',
            gtk: '123',
            g_tk: '123',
            p_uin: 'o10001',
            uin: 'o10001'
        })
    })

    it('keeps explicit canonical fields authoritative over aliases', () => {
        expect(
            parseCookies('pskey=alias; p_skey=canonical').get('p_skey')
        ).toBe('canonical')
        expect(
            parseCookies('p_skey=canonical; pskey=alias').get('p_skey')
        ).toBe('canonical')
    })

    it.each([
        [{ uin: 'o10001' }, '10001'],
        [{ p_uin: 'O10002' }, '10002'],
        [{ ptui_loginuin: '10003' }, '10003'],
        [{ luin: '10004' }, '10004'],
        [{ uin: 'invalid', p_uin: 'o10005' }, '10005']
    ])('finds the account ID from candidate cookies', (input, accountId) => {
        expect(parseAccountId(parseCookies(input))).toBe(accountId)
    })

    it('rejects malformed JSON and non-object JSON', () => {
        expect(() => parseCookies('{bad')).toThrow(QzoneValidationError)
        expect(() => parseCookies('[]')).toThrow('Cookie JSON 必须是对象')
    })

    it('rejects conflicting Cookie account fields', () => {
        expect(() =>
            parseAccountId(parseCookies('uin=o10001; p_uin=o10002'))
        ).toThrow('Cookie 中的账号字段不一致')
    })

    it('serializes normalized cookies as a Cookie header', () => {
        expect(
            serializeCookies(parseCookies('uin=o10001; p_skey=secret'))
        ).toBe('uin=o10001; p_skey=secret; p_uin=o10001')
    })

    it('replaces and removes canonical Cookie aliases together', () => {
        const cookies = parseCookies('uin=o10001; pskey=old')

        expect(
            mergeCookies(cookies, new Map([['p_skey', 'new']])).get('p_skey')
        ).toBe('new')
        expect(
            mergeCookies(cookies, new Map([['p_skey', null]])).has('pskey')
        ).toBe(false)
    })
})
