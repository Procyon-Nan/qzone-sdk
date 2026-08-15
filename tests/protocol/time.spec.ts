import { describe, expect, it } from 'vitest'

import {
    extractCreatedAt,
    parseQzoneTimestamp
} from '../../src/protocol/time.js'

describe('protocol time parsing', () => {
    it.each([
        [1_690_000_000, '2023-07-22T04:26:40.000Z'],
        ['1690000000000', '2023-07-22T04:26:40.000Z'],
        ['2026-05-20 13:45:06', '2026-05-20T05:45:06.000Z'],
        ['2026年5月20日 13:45', '2026-05-20T05:45:00.000Z']
    ])('normalizes %s', (value, expected) => {
        expect(parseQzoneTimestamp(value)).toBe(expected)
    })

    it('reads confirmed nested and HTML time fields', () => {
        expect(extractCreatedAt({ cell_comm: '{"abstime":1690000000}' })).toBe(
            '2023-07-22T04:26:40.000Z'
        )
        expect(
            extractCreatedAt({
                data: { original: { uploadTime: '1690000003000' } }
            })
        ).toBe('2023-07-22T04:26:43.000Z')
        expect(
            extractCreatedAt({ html: '<div data-abstime=1690000001>x</div>' })
        ).toBe('2023-07-22T04:26:41.000Z')
    })

    it('does not replace missing or unreasonable timestamps with now', () => {
        expect(parseQzoneTimestamp('99999999999999999')).toBeNull()
        expect(parseQzoneTimestamp('2026-02-31 13:45:06')).toBeNull()
        expect(extractCreatedAt({ summary: 'no time' })).toBeNull()
    })
})
