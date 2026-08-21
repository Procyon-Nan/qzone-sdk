import type { QzoneError } from '../errors.js'
import type { QzoneLogEvent, QzoneLogger } from '../types.js'

export function emitLog(
    logger: QzoneLogger | undefined,
    event: QzoneLogEvent
): void {
    try {
        logger?.(Object.freeze({ ...event }))
    } catch {
        // Logging must not affect protocol behavior.
    }
}

export function logReadFallback(
    logger: QzoneLogger | undefined,
    endpoint: string,
    fallbackEndpoint: string,
    error: QzoneError
): void {
    const { statusCode } = error.context ?? {}
    emitLog(logger, {
        level: 'info',
        phase: 'read.fallback',
        endpoint,
        fallbackEndpoint,
        ...(statusCode !== undefined ? { statusCode } : {}),
        errorCode: error.code
    })
}
