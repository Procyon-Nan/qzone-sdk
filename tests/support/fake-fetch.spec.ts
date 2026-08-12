import { describe, expect, it } from 'vitest'

import { createFakeFetch } from './fake-fetch.js'
import { jsonResponse, textResponse } from './fixtures.js'

describe('fake fetch support', () => {
    it('returns queued responses and records independent requests', async () => {
        const fake = createFakeFetch([
            jsonResponse({ page: 1 }),
            (request) => textResponse(`${request.method} ${request.url}`)
        ])

        const first = await fake.fetch('https://example.test/first')
        const second = await fake.fetch('https://example.test/second', {
            method: 'POST'
        })

        expect(await first.json()).toEqual({ page: 1 })
        expect(await second.text()).toBe('POST https://example.test/second')
        expect(fake.calls.map((request) => request.url)).toEqual([
            'https://example.test/first',
            'https://example.test/second'
        ])
    })

    it('fails on unexpected network calls', async () => {
        const fake = createFakeFetch([])

        await expect(
            fake.fetch('https://example.test/unexpected')
        ).rejects.toThrow(
            'Unexpected fetch call: GET https://example.test/unexpected'
        )
    })
})
