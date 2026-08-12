import { QzoneCancelledError } from '../errors.js'

export type AttemptFailureKind = 'cancelled' | 'timeout' | 'network'

export class AttemptFailure extends Error {
    constructor(
        readonly kind: AttemptFailureKind,
        readonly cause: unknown
    ) {
        super(kind)
    }
}

export function combineSignals(
    caller: AbortSignal | undefined,
    timeoutMs: number
): {
    readonly signal: AbortSignal
    readonly aborted: Promise<never>
    readonly timedOut: () => boolean
    readonly cleanup: () => void
} {
    const controller = new AbortController()
    let timeoutReached = false
    let rejectAborted!: (reason: unknown) => void
    const aborted = new Promise<never>((_, reject) => {
        rejectAborted = reject
    })
    const abort = (reason: unknown): void => {
        if (controller.signal.aborted) {
            return
        }
        controller.abort(reason)
        rejectAborted(reason)
    }
    const onCallerAbort = (): void => abort(caller?.reason)
    caller?.addEventListener('abort', onCallerAbort, { once: true })
    if (caller?.aborted) {
        onCallerAbort()
    }
    const timer = setTimeout(() => {
        timeoutReached = true
        abort(new DOMException('Request timed out', 'TimeoutError'))
    }, timeoutMs)

    return {
        signal: controller.signal,
        aborted,
        timedOut: () => timeoutReached,
        cleanup: () => {
            clearTimeout(timer)
            caller?.removeEventListener('abort', onCallerAbort)
        }
    }
}

export async function delay(ms: number, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal)
    if (ms <= 0) {
        return
    }
    await new Promise<void>((resolve, reject) => {
        const finish = (): void => {
            signal?.removeEventListener('abort', onAbort)
            resolve()
        }
        const onAbort = (): void => {
            clearTimeout(timer)
            signal?.removeEventListener('abort', onAbort)
            reject(new QzoneCancelledError())
        }
        signal?.addEventListener('abort', onAbort, { once: true })
        const timer = setTimeout(finish, ms)
    })
}

export function throwIfAborted(signal?: AbortSignal, endpoint?: string): void {
    if (signal?.aborted) {
        throw new QzoneCancelledError('Qzone operation was cancelled', {
            context: { endpoint }
        })
    }
}
