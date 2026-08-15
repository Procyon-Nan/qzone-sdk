import { describe, expect, it } from 'vitest'

import { QzoneValidationError } from '../../src/index.js'
import { FeedCursorStore } from '../../src/internal/cursor.js'

const CONTEXT = {
    accountId: '10001',
    scope: 'profile' as const,
    targetId: '10002'
}
const POSITION = {
    source: 'modern-profile',
    backendCursor: 'backend-1',
    page: 1,
    beginTime: 0,
    pageSize: 10
}

describe('Feed cursor store', () => {
    it('round-trips only within the owning instance and context', () => {
        const store = new FeedCursorStore<{ readonly marker: string }>()
        const cursor = store.create(CONTEXT, POSITION, { marker: 'state' })

        expect(store.read(cursor, CONTEXT)).toEqual({ marker: 'state' })
        expect(() => new FeedCursorStore().read(cursor, CONTEXT)).toThrow(
            QzoneValidationError
        )
        expect(() =>
            store.read(cursor, { ...CONTEXT, accountId: '10003' })
        ).toThrow(QzoneValidationError)
        expect(() =>
            store.read(cursor, { ...CONTEXT, scope: 'friends' })
        ).toThrow(QzoneValidationError)
        expect(() =>
            store.read(cursor, { ...CONTEXT, targetId: '10004' })
        ).toThrow(QzoneValidationError)
    })

    it('rejects malformed, tampered and cleared cursors', () => {
        const store = new FeedCursorStore<string>()
        const cursor = store.create(CONTEXT, POSITION, 'state')

        expect(() => store.read('invalid', CONTEXT)).toThrow(
            QzoneValidationError
        )
        expect(() => store.read(`${cursor}x`, CONTEXT)).toThrow(
            QzoneValidationError
        )
        store.clear()
        expect(() => store.read(cursor, CONTEXT)).toThrow(QzoneValidationError)
    })
})
