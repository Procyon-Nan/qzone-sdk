import { describe, expect, it } from 'vitest'

import {
    QzoneAuthError,
    QzoneCancelledError,
    QzoneError,
    QzoneParseError,
    QzonePermissionError,
    QzoneRateLimitError,
    QzoneRequestError,
    QzoneValidationError
} from '../src/index.js'
import type { QzoneErrorOptions } from '../src/index.js'

type QzoneErrorConstructor = new (
    message: string,
    options?: QzoneErrorOptions
) => QzoneError

const errorCases: ReadonlyArray<
    readonly [QzoneErrorConstructor, QzoneError['code']]
> = [
    [QzoneValidationError, 'QZONE_VALIDATION'],
    [QzoneAuthError, 'QZONE_AUTH'],
    [QzoneRequestError, 'QZONE_REQUEST'],
    [QzoneRateLimitError, 'QZONE_RATE_LIMIT'],
    [QzonePermissionError, 'QZONE_PERMISSION'],
    [QzoneParseError, 'QZONE_PARSE'],
    [QzoneCancelledError, 'QZONE_CANCELLED']
]

describe('Qzone errors', () => {
    it.each(errorCases)('assigns a stable code to %s', (ErrorType, code) => {
        const error = new ErrorType('failure')

        expect(error).toBeInstanceOf(QzoneError)
        expect(error.name).toBe(ErrorType.name)
        expect(error.code).toBe(code)
        expect(error.message).toBe('failure')
    })

    it('preserves the cause and copies diagnostic context', () => {
        const cause = new Error('network')
        const context = { endpoint: 'feed.list', statusCode: 503 }
        const error = new QzoneRequestError('request failed', {
            cause,
            context
        })

        context.statusCode = 200

        expect(error.cause).toBe(cause)
        expect(error.context).toEqual({
            endpoint: 'feed.list',
            statusCode: 503
        })
        expect(Object.isFrozen(error.context)).toBe(true)
    })

    it('uses a stable default cancellation message', () => {
        expect(new QzoneCancelledError().message).toBe(
            'Qzone operation was cancelled'
        )
    })
})
