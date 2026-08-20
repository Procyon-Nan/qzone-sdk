/** SDK 公共错误的稳定机器可读代码。 */
export type QzoneErrorCode =
    | 'QZONE_VALIDATION'
    | 'QZONE_AUTH'
    | 'QZONE_REQUEST'
    | 'QZONE_NOT_FOUND'
    | 'QZONE_RATE_LIMIT'
    | 'QZONE_PERMISSION'
    | 'QZONE_PARSE'
    | 'QZONE_CANCELLED'

/** 不包含凭据和完整响应正文的有限错误诊断上下文。 */
export interface QzoneErrorContext {
    readonly operation?: string
    readonly endpoint?: string
    readonly statusCode?: number
    readonly serviceCode?: number
    readonly retryCount?: number
    readonly responseSnippet?: string
}

/** 公共错误构造参数。 */
export interface QzoneErrorOptions extends ErrorOptions {
    readonly context?: QzoneErrorContext
}

/** 所有 SDK 公共错误的基类。 */
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

/** 调用参数、状态前置条件或本地数据验证失败。 */
export class QzoneValidationError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_VALIDATION', options)
    }
}

/** Session 缺失、失效或被 QQ 登录流程拒绝。 */
export class QzoneAuthError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_AUTH', options)
    }
}

/** 网络、HTTP 状态或 Session 持久化等请求链路失败。 */
export class QzoneRequestError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_REQUEST', options)
    }
}

/** 目标资源被 QQ 空间协议明确报告为不存在。 */
export class QzoneNotFoundError extends QzoneRequestError {
    override readonly code = 'QZONE_NOT_FOUND' as const
}

/** QQ 空间服务端触发频率限制。 */
export class QzoneRateLimitError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_RATE_LIMIT', options)
    }
}

/** 当前账号无权访问或操作目标。 */
export class QzonePermissionError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_PERMISSION', options)
    }
}

/** QQ 空间响应无法按受支持的协议格式解析。 */
export class QzoneParseError extends QzoneError {
    constructor(message: string, options?: QzoneErrorOptions) {
        super(message, 'QZONE_PARSE', options)
    }
}

/** 操作在发送写请求前被取消，或读取请求被取消。 */
export class QzoneCancelledError extends QzoneError {
    constructor(
        message = 'Qzone operation was cancelled',
        options?: QzoneErrorOptions
    ) {
        super(message, 'QZONE_CANCELLED', options)
    }
}
