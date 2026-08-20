import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import type {
    QzoneLogEvent,
    QzoneSession,
    QzoneSessionInput
} from '../../src/index.js'

export interface E2eConfig {
    readonly session: QzoneSessionInput
    readonly expectedAccountId?: string
    readonly profileUserId?: string
    readonly allowWrites: boolean
}

export interface StepSummary {
    readonly [key: string]: unknown
}

export class E2eEvidence {
    readonly directory: string
    readonly fetch: typeof globalThis.fetch
    readonly logger: (event: QzoneLogEvent) => void
    readonly #stepsPath: string
    readonly #requestsPath: string
    readonly #baseFetch: typeof globalThis.fetch
    readonly #logs: QzoneLogEvent[] = []
    #requestSequence = 0
    #writeTail: Promise<void> = Promise.resolve()

    private constructor(directory: string, baseFetch: typeof globalThis.fetch) {
        this.directory = directory
        this.#baseFetch = baseFetch
        this.#stepsPath = resolve(directory, 'steps.ndjson')
        this.#requestsPath = resolve(directory, 'requests.ndjson')
        this.fetch = this.#captureFetch.bind(this)
        this.logger = (event) => this.#logs.push(event)
    }

    static async create(
        runId: string,
        baseFetch: typeof globalThis.fetch = globalThis.fetch
    ): Promise<E2eEvidence> {
        const directory = resolve('tmp', 'e2e', runId)
        await mkdir(directory, { recursive: true })
        return new E2eEvidence(directory, baseFetch)
    }

    async step<T>(
        name: string,
        run: () => Promise<T> | T,
        summarize: (result: T) => StepSummary = () => ({})
    ): Promise<T> {
        const startedAt = new Date().toISOString()
        const started = performance.now()
        try {
            const result = await run()
            await this.#appendStep({
                name,
                status: 'passed',
                startedAt,
                durationMs: Math.round(performance.now() - started),
                details: summarize(result)
            })
            return result
        } catch (error) {
            await this.#appendStep({
                name,
                status: 'failed',
                startedAt,
                durationMs: Math.round(performance.now() - started),
                error: serializeError(error)
            })
            throw error
        }
    }

    async note(name: string, details: StepSummary): Promise<void> {
        await this.#appendStep({
            name,
            status: 'recorded',
            startedAt: new Date().toISOString(),
            durationMs: 0,
            details
        })
    }

    async saveSession(session: QzoneSession): Promise<void> {
        await this.#write(() =>
            writeJson(resolve(this.directory, 'session-summary.json'), {
                updatedAt: session.updatedAt,
                cookieCount: Object.keys(session.cookies).length,
                tokenCount: Object.keys(session.tokens).length
            })
        )
    }

    async finish(status: 'passed' | 'failed', error?: unknown): Promise<void> {
        await this.#write(async () => {
            await writeJson(resolve(this.directory, 'result.json'), {
                status,
                finishedAt: new Date().toISOString(),
                requestCount: this.#requestSequence,
                ...(error === undefined ? {} : { error: serializeError(error) })
            })
            await writeJson(
                resolve(this.directory, 'sdk-logs.json'),
                this.#logs
            )
        })
    }

    async #captureFetch(
        input: Parameters<typeof globalThis.fetch>[0],
        init?: Parameters<typeof globalThis.fetch>[1]
    ): Promise<Response> {
        const sequence = ++this.#requestSequence
        const request = new Request(input, init)
        const startedAt = new Date().toISOString()
        const started = performance.now()

        try {
            const response = await this.#baseFetch(request)
            await this.#append(this.#requestsPath, {
                sequence,
                startedAt,
                durationMs: Math.round(performance.now() - started),
                method: request.method,
                statusCode: response.status
            })
            return response
        } catch (error) {
            await this.#append(this.#requestsPath, {
                sequence,
                startedAt,
                durationMs: Math.round(performance.now() - started),
                method: request.method,
                error: serializeError(error)
            })
            throw error
        }
    }

    async #appendStep(entry: Readonly<Record<string, unknown>>): Promise<void> {
        await this.#append(this.#stepsPath, entry)
    }

    async #append(path: string, value: unknown): Promise<void> {
        await this.#write(() => appendJsonLine(path, value))
    }

    #write(write: () => Promise<void>): Promise<void> {
        const pending = this.#writeTail.then(write)
        this.#writeTail = pending.catch(() => undefined)
        return pending
    }
}

export function e2eEnabled(): boolean {
    return process.env.QZONE_E2E_ENABLED === '1'
}

export async function loadE2eConfig(): Promise<E2eConfig> {
    const sessionText =
        process.env.QZONE_E2E_SESSION_JSON ??
        (await readFile(
            resolve(
                process.env.QZONE_E2E_SESSION_FILE ??
                    resolve('tmp', 'qzone-session.json')
            ),
            'utf8'
        ))
    const session = parseSession(sessionText)
    const expectedAccountId = optionalEnvironmentValue(
        'QZONE_E2E_EXPECTED_ACCOUNT_ID'
    )
    const profileUserId = optionalEnvironmentValue('QZONE_E2E_PROFILE_USER_ID')
    return {
        session,
        allowWrites: process.env.QZONE_E2E_ALLOW_WRITES === '1',
        ...(expectedAccountId ? { expectedAccountId } : {}),
        ...(profileUserId ? { profileUserId } : {})
    }
}

export function createBmpImage(): Uint8Array {
    const width = 32
    const height = 32
    const rowSize = Math.ceil((width * 3) / 4) * 4
    const pixelSize = rowSize * height
    const bytes = new Uint8Array(54 + pixelSize)
    const view = new DataView(bytes.buffer)
    bytes[0] = 0x42
    bytes[1] = 0x4d
    view.setUint32(2, bytes.byteLength, true)
    view.setUint32(10, 54, true)
    view.setUint32(14, 40, true)
    view.setInt32(18, width, true)
    view.setInt32(22, height, true)
    view.setUint16(26, 1, true)
    view.setUint16(28, 24, true)
    view.setUint32(34, pixelSize, true)

    for (let row = 0; row < height; row += 1) {
        for (let column = 0; column < width; column += 1) {
            const offset = 54 + row * rowSize + column * 3
            bytes[offset] = 0x40
            bytes[offset + 1] = 0x80
            bytes[offset + 2] = 0xc0
        }
    }
    return bytes
}

export function serializeError(
    error: unknown
): Readonly<Record<string, unknown>> {
    if (!(error instanceof Error)) {
        return { name: 'UnknownError' }
    }
    const typed = error as Error & {
        readonly code?: unknown
        readonly context?: unknown
    }
    const context = summarizeErrorContext(typed.context)
    return {
        name: error.name,
        ...(typeof typed.code === 'string' ? { code: typed.code } : {}),
        ...(context ? { context } : {})
    }
}

function summarizeErrorContext(
    value: unknown
): Readonly<Record<string, string | number>> | undefined {
    if (!value || typeof value !== 'object') {
        return undefined
    }
    const context = value as Record<string, unknown>
    const summary: Record<string, string | number> = {}
    for (const key of [
        'operation',
        'endpoint',
        'statusCode',
        'serviceCode',
        'retryCount'
    ]) {
        const item = context[key]
        if (typeof item === 'string' || typeof item === 'number') {
            summary[key] = item
        }
    }
    return Object.keys(summary).length > 0 ? summary : undefined
}

function parseSession(value: string): QzoneSessionInput {
    const parsed: unknown = JSON.parse(value)
    if (!parsed || typeof parsed !== 'object' || !('cookies' in parsed)) {
        throw new TypeError('E2E Session JSON 必须是包含 cookies 的对象')
    }
    return parsed as QzoneSessionInput
}

function optionalEnvironmentValue(name: string): string | undefined {
    const value = process.env[name]?.trim()
    return value || undefined
}

async function appendJsonLine(path: string, value: unknown): Promise<void> {
    await appendFile(path, `${JSON.stringify(value)}\n`, 'utf8')
}

async function writeJson(path: string, value: unknown): Promise<void> {
    await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
