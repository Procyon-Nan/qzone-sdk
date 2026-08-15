import { describe, expect, it } from 'vitest'

import { QzoneParseError } from '../../src/index.js'
import {
    parseIndexPageHtml,
    parseProfilePageHtml
} from '../../src/protocol/page.js'

describe('Qzone page HTML parsing', () => {
    it('extracts index feed data and token from a non-strict literal', () => {
        const page = parseIndexPageHtml(
            pageHtml(`{
                feedpage: {
                    /* a closing brace in a comment must not end the literal: } */
                    vFeeds: [{fid: 'post-1', hostuin: '10001'}],
                    attachinfo: 'cursor-1',
                    hasmore: true,
                },
            }`)
        )

        expect(page).toEqual({
            token: 'abc123',
            feed: {
                feedpage: {
                    vFeeds: [{ fid: 'post-1', hostuin: '10001' }],
                    attachinfo: 'cursor-1',
                    hasmore: true
                }
            }
        })
    })

    it('extracts the profile feed page and tolerates the observed trailing hole', () => {
        const page = parseProfilePageHtml(
            pageHtml(`[
                {data: {nickname: '用户'}},
                {data: {vFeeds: [{fid: 'post-2'}]}},,
            ]`)
        )

        expect(page).toEqual({
            token: 'abc123',
            feed: { vFeeds: [{ fid: 'post-2' }] }
        })
    })

    it('rejects executable expressions instead of evaluating them', () => {
        expect(() =>
            parseIndexPageHtml(pageHtml('{feedpage: buildFeed()}'))
        ).toThrow(QzoneParseError)
        expect(globalThis).not.toHaveProperty('buildFeed')
    })
})

function pageHtml(data: string): string {
    return `<script>
        window.shine0callback = function () { return "abc123"; };
        var FrontPage = { data: ${data} };
    </script>`
}
