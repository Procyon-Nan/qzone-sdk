import { randomUUID } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { QzoneRequestError } from '../../src/index.js'
import { E2eEvidence, serializeError } from './harness.js'

describe('E2E evidence', () => {
    it('records only a safe request summary', async () => {
        const runId = `harness-${randomUUID()}`
        const evidence = await E2eEvidence.create(runId, async () => {
            return new Response('response-secret', {
                status: 404,
                headers: { 'set-cookie': 'p_skey=response-cookie' }
            })
        })
        try {
            await evidence.fetch(
                new Request(
                    'https://h5.qzone.qq.com/detail?g_tk=query-secret',
                    {
                        method: 'POST',
                        headers: { cookie: 'p_skey=request-cookie' },
                        body: 'content=body-secret'
                    }
                )
            )
            await evidence.step(
                'post.detail.not-found',
                () => ({ name: 'QzoneNotFoundError', code: 'QZONE_NOT_FOUND' }),
                (result) => result
            )

            const requests = await readFile(
                resolve(evidence.directory, 'requests.ndjson'),
                'utf8'
            )
            expect(JSON.parse(requests)).toEqual(
                expect.objectContaining({ method: 'POST', statusCode: 404 })
            )
            expect(requests).not.toMatch(
                /qzone|g_tk|p_skey|cookie|secret|content/iu
            )

            const steps = await readFile(
                resolve(evidence.directory, 'steps.ndjson'),
                'utf8'
            )
            expect(JSON.parse(steps)).toMatchObject({
                details: {
                    name: 'QzoneNotFoundError',
                    code: 'QZONE_NOT_FOUND'
                }
            })
        } finally {
            await rm(evidence.directory, { recursive: true, force: true })
        }
    })

    it('keeps only whitelisted public error context', () => {
        const error = new QzoneRequestError('secret message', {
            context: {
                operation: 'post.detail',
                endpoint: 'post.detail.h5',
                statusCode: 404,
                responseSnippet: 'response-secret'
            }
        })

        expect(serializeError(error)).toEqual({
            name: 'QzoneRequestError',
            code: 'QZONE_REQUEST',
            context: {
                operation: 'post.detail',
                endpoint: 'post.detail.h5',
                statusCode: 404
            }
        })
    })
})
