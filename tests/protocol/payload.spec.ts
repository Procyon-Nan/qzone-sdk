import { describe, expect, it } from 'vitest'

import { QzoneAuthError, QzoneRequestError } from '../../src/errors.js'
import { assertPayloadSuccess } from '../../src/protocol/payload.js'

describe('payload status assertions', () => {
    it('accepts payloads without a failing status', () => {
        expect(() => assertPayloadSuccess({}, 'feed.active')).not.toThrow()
        expect(() =>
            assertPayloadSuccess({ code: 0 }, 'feed.active')
        ).not.toThrow()
        expect(() =>
            assertPayloadSuccess({ ret: '0', data: { code: 0 } }, 'feed.active')
        ).not.toThrow()
        expect(() =>
            assertPayloadSuccess({ data: { data: { code: 0 } } }, 'feed.active')
        ).not.toThrow()
    })

    it('keeps definite service failures as request errors', () => {
        let failure: unknown
        try {
            assertPayloadSuccess(
                { code: -8, message: '对不起，原文已经被删除，无法查看' },
                'post.detail.h5'
            )
        } catch (error) {
            failure = error
        }

        expect(failure).toBeInstanceOf(QzoneRequestError)
        expect(failure).toMatchObject({
            context: { endpoint: 'post.detail.h5', serviceCode: -8 }
        })
    })

    it('maps the expired-session service code to an auth error', () => {
        let failure: unknown
        try {
            assertPayloadSuccess(
                { code: -3000, msg: '请先登录' },
                'feed.active'
            )
        } catch (error) {
            failure = error
        }

        expect(failure).toBeInstanceOf(QzoneAuthError)
        expect(failure).toMatchObject({
            message: '请先登录',
            context: { endpoint: 'feed.active', serviceCode: -3000 }
        })
    })

    it('maps expired sessions reported by nested data containers', () => {
        let failure: unknown
        try {
            assertPayloadSuccess(
                { code: 0, data: { ret: -3000 } },
                'feed.recent'
            )
        } catch (error) {
            failure = error
        }

        expect(failure).toBeInstanceOf(QzoneAuthError)
        expect(failure).toMatchObject({
            context: { endpoint: 'feed.recent', serviceCode: -3000 }
        })
    })

    it('maps keyword-only session failures from any status field', () => {
        for (const payload of [
            { err: -2, text: 'skey expired' },
            { error: -3, msg: '会话失效' },
            { code: -1, message: 'Please Login first' }
        ]) {
            let failure: unknown
            try {
                assertPayloadSuccess(payload, 'feed.legacy')
            } catch (error) {
                failure = error
            }

            expect(failure).toBeInstanceOf(QzoneAuthError)
        }
    })

    it('falls back to a stable message when the payload has none', () => {
        let failure: unknown
        try {
            assertPayloadSuccess({ ret: '-3000' }, 'feed.active')
        } catch (error) {
            failure = error
        }

        expect(failure).toBeInstanceOf(QzoneAuthError)
        expect(failure).toMatchObject({
            message: 'QQ 空间登录态已失效',
            context: { serviceCode: -3000 }
        })
    })

    it('does not misclassify unrelated service messages as auth failures', () => {
        let failure: unknown
        try {
            assertPayloadSuccess(
                { code: -10005, msg: '未输入内容' },
                'comment.create'
            )
        } catch (error) {
            failure = error
        }

        expect(failure).toBeInstanceOf(QzoneRequestError)
        expect(failure).not.toBeInstanceOf(QzoneAuthError)
        expect(failure).toMatchObject({
            context: { endpoint: 'comment.create', serviceCode: -10005 }
        })
    })
})
