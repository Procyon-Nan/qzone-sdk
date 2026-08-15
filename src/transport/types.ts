import type { QzoneId } from '../types.js'

export type TransportMethod = 'GET' | 'POST'
export type TransportOperation = 'read' | 'write'
export type TransportRedirectPolicy = 'none' | 'qq' | 'qq-write-accepted'

export interface TransportEndpoint {
    readonly id: string
    readonly method: TransportMethod
    readonly url: string
    readonly operation: TransportOperation
    readonly authentication?: 'none' | 'required'
    readonly includeGtk?: boolean
    readonly tokenAccountId?: QzoneId
    readonly referer?: string
    readonly origin?: string
    readonly redirect?: TransportRedirectPolicy
    readonly redirectFollowPath?: string
}

export type TransportParameter = string | number | boolean | null | undefined

export interface TransportRequestOptions {
    readonly query?: Readonly<
        Record<string, TransportParameter | readonly TransportParameter[]>
    >
    readonly form?: Readonly<
        Record<string, TransportParameter | readonly TransportParameter[]>
    >
    readonly headers?: Readonly<Record<string, string>>
    readonly signal?: AbortSignal
}

export interface TransportResponse {
    readonly status: number
    readonly url: string
    readonly headers: Headers
    readonly text: string
}
