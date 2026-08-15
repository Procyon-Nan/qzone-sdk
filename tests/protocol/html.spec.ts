import { describe, expect, it } from 'vitest'

import { QzoneParseError } from '../../src/index.js'
import {
    decodeHtmlEntities,
    extractClassText,
    extractHtmlAttribute,
    extractScripts,
    htmlToText
} from '../../src/protocol/html.js'
import { extractQzoneToken } from '../../src/protocol/token.js'

describe('protocol HTML parsing', () => {
    it('decodes entities and normalizes markup without executing scripts', () => {
        expect(htmlToText('<div>A&amp;B<br>下一行</div>')).toBe('A&B\n下一行')
        expect(decodeHtmlEntities('&#x4f60;&#22909;&nbsp;')).toBe('你好\u00a0')
        expect(
            extractClassText('<div class="x f-info y">正文</div>', 'f-info')
        ).toBe('正文')
        expect(
            extractHtmlAttribute('<div data-fid="a&amp;b">', 'data-fid')
        ).toBe('a&b')
        expect(extractScripts('<script>window.called = true</script>')).toEqual(
            ['window.called = true']
        )
        expect(globalThis).not.toHaveProperty('called')
    })

    it('extracts only a hexadecimal shine0callback token', () => {
        expect(
            extractQzoneToken(
                '<script>window.shine0callback=function(){return "abc123";};</script>'
            )
        ).toBe('abc123')
        expect(() =>
            extractQzoneToken(
                '<script>window.shine0callback=function(){return userToken;};</script>'
            )
        ).toThrow(QzoneParseError)
    })
})
