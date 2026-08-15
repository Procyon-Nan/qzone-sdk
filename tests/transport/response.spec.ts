import { describe, expect, it } from 'vitest'

import { QzoneParseError } from '../../src/index.js'
import {
    createDiagnosticSnippet,
    parseResponseData
} from '../../src/transport/response.js'

describe('transport response parsing', () => {
    it.each(['', '  \r\n '])('normalizes an empty response', (value) => {
        expect(parseResponseData(value)).toEqual({})
    })

    it('parses JSON and dotted JSONP callbacks', () => {
        expect(parseResponseData('{"ok":true}')).toEqual({ ok: true })
        expect(parseResponseData('window.callback({"ok":true});')).toEqual({
            ok: true
        })
    })

    it('parses observed QQ JavaScript literal variants without evaluation', () => {
        expect(
            parseResponseData(
                "_preloadCallback({ret:0,data:[{fid:'post-1',enabled:true}],missing:undefined,});"
            )
        ).toEqual({
            ret: 0,
            data: [{ fid: 'post-1', enabled: true }],
            missing: null
        })
    })

    it('rejects malformed responses without evaluating code', () => {
        expect(() =>
            parseResponseData('callback(alert(1))', 'feed.list')
        ).toThrow(QzoneParseError)
        expect(() => parseResponseData('[1,,2]')).toThrow(QzoneParseError)
    })

    it('limits and redacts diagnostic snippets', () => {
        const snippet = createDiagnosticSnippet(
            `p_skey=secret qzonetoken=token ${'x'.repeat(300)}`
        )

        expect(snippet).not.toContain('secret')
        expect(snippet).not.toContain('token=token')
        expect(snippet.length).toBeLessThanOrEqual(200)
    })
})
