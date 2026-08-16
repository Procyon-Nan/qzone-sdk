import { QzoneAuthError, QzoneRequestError } from '../errors.js'
import { asRecord, firstValue, toText, type ProtocolRecord } from './value.js'

/** QQ 空间业务码与提示语中表示登录态失效的集合，超出此范围的失败仍为请求错误。 */
const AUTH_PAYLOAD_CODES: ReadonlySet<number> = new Set([-3000])
const AUTH_PAYLOAD_KEYWORDS: readonly string[] = [
    '登录',
    '失效',
    'skey',
    'g_tk',
    'cookie',
    'expired',
    'login'
]

export function assertPayloadSuccess(value: unknown, endpoint: string): void {
    for (const record of payloadRecords(value).slice(0, 2)) {
        for (const key of ['ret', 'code', 'err', 'error']) {
            if (!Object.hasOwn(record, key)) {
                continue
            }
            const status = record[key]
            if (
                status === null ||
                status === undefined ||
                status === false ||
                status === 0 ||
                status === '0'
            ) {
                continue
            }
            const serviceCode = toServiceCode(status)
            const message = toText(
                firstValue(record, ['msg', 'message', 'text'])
            ).trim()
            const context = {
                endpoint,
                ...(serviceCode === undefined ? {} : { serviceCode })
            }
            if (isAuthPayloadFailure(serviceCode, message)) {
                throw new QzoneAuthError(message || 'QQ 空间登录态已失效', {
                    context
                })
            }
            throw new QzoneRequestError('QQ 空间接口返回错误', { context })
        }
    }
}

export function payloadRecords(value: unknown): readonly ProtocolRecord[] {
    const records: ProtocolRecord[] = []
    let current = asRecord(value)
    for (let depth = 0; current && depth < 4; depth += 1) {
        records.push(current)
        current = asRecord(current.data)
    }
    return records
}

function isAuthPayloadFailure(
    serviceCode: number | undefined,
    message: string
): boolean {
    if (serviceCode !== undefined && AUTH_PAYLOAD_CODES.has(serviceCode)) {
        return true
    }
    const normalized = message.toLowerCase()
    return AUTH_PAYLOAD_KEYWORDS.some((keyword) => normalized.includes(keyword))
}

function toServiceCode(value: unknown): number | undefined {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined
    }
    if (typeof value !== 'string' || value.trim() === '') {
        return undefined
    }

    const numeric = Number(value)
    return Number.isFinite(numeric) ? numeric : undefined
}
