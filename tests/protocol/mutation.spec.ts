import { describe, expect, it } from 'vitest'

import { QzoneAuthError, QzoneRequestError } from '../../src/errors.js'
import { parseMutationReceipt } from '../../src/protocol/mutation.js'

describe('mutation receipts', () => {
    it('reads identifiers and messages from nested payloads', () => {
        expect(
            parseMutationReceipt(
                { code: 0, data: { commentId: 123, message: '已受理' } },
                'comment.create'
            )
        ).toEqual({ id: '123', message: '已受理' })
    })

    it('accepts successful payloads without identifiers', () => {
        expect(parseMutationReceipt({ ret: 0 }, 'post.like.proxy')).toEqual({
            id: null
        })
        expect(
            parseMutationReceipt({ ret: 0, commentid: 0 }, 'comment.create')
        ).toEqual({ id: null })
    })

    it('rejects explicit protocol failures', () => {
        let failure: unknown
        try {
            parseMutationReceipt({ code: -1 }, 'comment.create')
        } catch (error) {
            failure = error
        }

        expect(failure).toBeInstanceOf(QzoneRequestError)
        expect(failure).toMatchObject({
            context: {
                endpoint: 'comment.create',
                serviceCode: -1
            }
        })
    })

    it('reports an expired session as an auth error instead of a receipt', () => {
        let failure: unknown
        try {
            parseMutationReceipt(
                { code: -3000, msg: '请先登录' },
                'comment.create'
            )
        } catch (error) {
            failure = error
        }

        expect(failure).toBeInstanceOf(QzoneAuthError)
        expect(failure).toMatchObject({
            message: '请先登录',
            context: {
                endpoint: 'comment.create',
                serviceCode: -3000
            }
        })
    })
})
