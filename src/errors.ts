export type QzoneErrorCode =
    | 'QZONE_VALIDATION'
    | 'QZONE_AUTH'
    | 'QZONE_REQUEST'
    | 'QZONE_RATE_LIMIT'
    | 'QZONE_PERMISSION'
    | 'QZONE_PARSE'
    | 'QZONE_CANCELLED'

export interface QzoneErrorContext {
    readonly operation?: string
    readonly endpoint?: string
    readonly statusCode?: number
    readonly retryCount?: number
    readonly responseSnippet?: string
}

export interface QzoneErrorOptions extends ErrorOptions {
    readonly context?: QzoneErrorContext
}

export class QzoneError extends Error {
    readonly code: QzoneErrorCode
    readonly context?: Readonly<QzoneErrorContext>

    constructor(
        message: string,
        code: QzoneErrorCode,
        options: QzoneErrorOptions = {}
    ) {
        super(message, { cause: options.cause })
        this.name = new.target.name
        this.code = code
        this.context = options.context
            ? Object.freeze({ ...options.context })
            : undefined
    }
}

export class QzoneValidationError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_VALIDATION', options)
    }
}

export class QzoneAuthError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_AUTH', options)
    }
}

export class QzoneRequestError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_REQUEST', options)
    }
}

export class QzoneRateLimitError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_RATE_LIMIT', options)
    }
}

export class QzonePermissionError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_PERMISSION', options)
    }
}

export class QzoneParseError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_PARSE', options)
    }
}

export class QzoneCancelledError extends QzoneError {
    constructor(
        message = 'Qzone operation was cancelled',
        options?: QzoneErrorOptions
    ) {
        super(message, 'QZONE_CANCELLED', options)
    }
}
