import { describe, expect, it, vi } from 'vitest'

import { WriteQueue } from '../../src/internal/write-queue.js'

describe('WriteQueue', () => {
    it('runs writes in FIFO order and continues after failures', async () => {
        const queue = new WriteQueue()
        const first = deferred<string>()
        const order: string[] = []

        const one = queue.run(undefined, async () => {
            order.push('one:start')
            const value = await first.promise
            order.push('one:end')
            return value
        })
        const two = queue.run(undefined, async () => {
            order.push('two')
            throw new Error('second failed')
        })
        const three = queue.run(undefined, async () => {
            order.push('three')
            return 'third'
        })

        await vi.waitFor(() => expect(order).toEqual(['one:start']))
        expect(queue.busy).toBe(true)
        first.resolve('first')

        await expect(one).resolves.toBe('first')
        await expect(two).rejects.toThrow('second failed')
        await expect(three).resolves.toBe('third')
        expect(order).toEqual(['one:start', 'one:end', 'two', 'three'])
        expect(queue.busy).toBe(false)
    })

    it('cancels an aborted write before it starts', async () => {
        const queue = new WriteQueue()
        const first = deferred<void>()
        const controller = new AbortController()
        const queuedRun = vi.fn(async () => undefined)

        const active = queue.run(undefined, () => first.promise)
        const queued = queue.run(controller.signal, queuedRun)
        const cancelled = expect(queued).rejects.toMatchObject({
            code: 'QZONE_CANCELLED',
            context: { operation: 'write.queue' }
        })
        controller.abort()

        await cancelled
        expect(queuedRun).not.toHaveBeenCalled()
        first.resolve(undefined)
        await active
    })

    it('closes atomically, cancels queued writes, and waits for the active write', async () => {
        const queue = new WriteQueue()
        const first = deferred<void>()
        const queuedRun = vi.fn(async () => undefined)

        const active = queue.run(undefined, () => first.promise)
        const queued = queue.run(undefined, queuedRun)
        const cancelled = expect(queued).rejects.toMatchObject({
            code: 'QZONE_CANCELLED',
            context: { operation: 'client.close' }
        })
        const closing = queue.close()
        let closed = false
        void closing.then(() => {
            closed = true
        })

        await cancelled
        await expect(
            queue.run(undefined, async () => undefined)
        ).rejects.toMatchObject({
            code: 'QZONE_VALIDATION',
            context: { operation: 'client.closed' }
        })
        expect(closed).toBe(false)
        expect(queuedRun).not.toHaveBeenCalled()

        first.resolve(undefined)
        await active
        await closing
        expect(closed).toBe(true)
    })
})

interface Deferred<T> {
    readonly promise: Promise<T>
    readonly resolve: (value: T | PromiseLike<T>) => void
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T | PromiseLike<T>) => void
    const promise = new Promise<T>((resolvePromise) => {
        resolve = resolvePromise
    })
    return { promise, resolve }
}
