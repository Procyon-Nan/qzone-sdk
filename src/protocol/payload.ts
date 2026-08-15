import { QzoneRequestError } from '../errors.js'
import { asRecord, type ProtocolRecord } from './value.js'

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
            throw new QzoneRequestError('QQ 空间接口返回错误', {
                context: { endpoint }
            })
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
