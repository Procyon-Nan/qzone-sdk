import { QzoneCancelledError, QzoneValidationError } from '../errors.js'

interface QueuedWrite {
    readonly run: () => Promise<unknown>
    readonly resolve: (value: unknown) => void
    readonly reject: (reason: unknown) => void
    readonly signal?: AbortSignal
    readonly onAbort?: () => void
}

export class WriteQueue {
    readonly #pending: QueuedWrite[] = []
    #active: Promise<void> | null = null
    #closed = false

    get closed(): boolean {
        return this.#closed
    }

    get busy(): boolean {
        return this.#active !== null || this.#pending.length > 0
    }

    run<T>(signal: AbortSignal | undefined, run: () => Promise<T>): Promise<T> {
        if (this.#closed) {
            return Promise.reject(clientClosedError())
        }
        if (signal?.aborted) {
            return Promise.reject(writeCancelled())
        }

        return new Promise<T>((resolve, reject) => {
            const queued: QueuedWrite = {
                run,
                resolve: (value) => resolve(value as T),
                reject,
                ...(signal ? { signal } : {}),
                ...(signal
                    ? {
                          onAbort: () => {
                              const index = this.#pending.indexOf(queued)
                              if (index < 0) {
                                  return
                              }
                              this.#pending.splice(index, 1)
                              this.#removeAbortListener(queued)
                              reject(writeCancelled())
                          }
                      }
                    : {})
            }
            signal?.addEventListener('abort', queued.onAbort!, { once: true })
            this.#pending.push(queued)
            this.#startNext()
        })
    }

    close(): Promise<void> {
        if (!this.#closed) {
            this.#closed = true
            for (const queued of this.#pending.splice(0)) {
                this.#removeAbortListener(queued)
                queued.reject(
                    new QzoneCancelledError(
                        '客户端关闭，排队中的写操作已取消',
                        {
                            context: { operation: 'client.close' }
                        }
                    )
                )
            }
        }
        return this.#active ?? Promise.resolve()
    }

    #startNext(): void {
        if (this.#active) {
            return
        }

        const queued = this.#pending.shift()
        if (!queued) {
            return
        }
        this.#removeAbortListener(queued)
        if (queued.signal?.aborted) {
            queued.reject(writeCancelled())
            this.#startNext()
            return
        }

        const execution = Promise.resolve().then(queued.run)
        this.#active = execution.then(
            (value) => {
                this.#finishActive()
                queued.resolve(value)
            },
            (error) => {
                this.#finishActive()
                queued.reject(error)
            }
        )
    }

    #removeAbortListener(queued: QueuedWrite): void {
        if (queued.signal && queued.onAbort) {
            queued.signal.removeEventListener('abort', queued.onAbort)
        }
    }

    #finishActive(): void {
        this.#active = null
        this.#startNext()
    }
}

function writeCancelled(): QzoneCancelledError {
    return new QzoneCancelledError('写操作在开始前已取消', {
        context: { operation: 'write.queue' }
    })
}

export function clientClosedError(): QzoneValidationError {
    return new QzoneValidationError('QzoneClient 已关闭', {
        context: { operation: 'client.closed' }
    })
}
