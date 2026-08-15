import { assertPayloadSuccess, payloadRecords } from './payload.js'
import { firstValue, toText } from './value.js'

export interface MutationReceipt {
    readonly id: string | null
    readonly message?: string
}

export function parseMutationReceipt(
    value: unknown,
    endpoint: string
): MutationReceipt {
    assertPayloadSuccess(value, endpoint)
    let id = ''
    let message = ''
    for (const record of payloadRecords(value)) {
        id ||= toText(firstValue(record, ['commentid', 'commentId'])).trim()
        message ||= toText(firstValue(record, ['msg', 'message'])).trim()
    }
    return Object.freeze({
        id: id && id !== '0' ? id : null,
        ...(message ? { message } : {})
    })
}
