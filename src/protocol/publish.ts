import { QzoneParseError } from '../errors.js'
import type { PreparedPublishImage } from './image.js'
import { assertPayloadSuccess, payloadRecords } from './payload.js'

export interface UploadedPhoto {
    readonly albumId: string
    readonly lloc: string
    readonly sloc: string
    readonly type: string
    readonly height: string
    readonly width: string
    readonly url: string
    readonly picBo: string
    readonly richval: string
}

export interface PublishReceipt {
    readonly postId: string | null
    readonly message?: string
}

export function parseUploadedPhoto(
    value: unknown,
    image: PreparedPublishImage
): UploadedPhoto {
    assertPayloadSuccess(value, 'post.image.upload')
    const records = payloadRecords(value)
    const albumId = firstText(records, ['albumid', 'albumId'])
    const lloc = firstText(records, ['lloc', 'LLoc'])
    const sloc = firstText(records, ['sloc', 'SLoc'])
    if (!albumId || !lloc || !sloc) {
        throw new QzoneParseError('图片上传响应缺少 richval 字段', {
            context: { endpoint: 'post.image.upload' }
        })
    }

    const type = firstText(records, ['type']) || String(image.qqType)
    const height = firstText(records, ['height', 'h']) || String(image.height)
    const width = firstText(records, ['width', 'w']) || String(image.width)
    const url =
        firstText(records, ['url', 'origin_url', 'originUrl', 'pre']) || ''
    const picBo =
        firstText(records, ['pic_bo', 'picBo']) || extractPicBo(url) || ''

    return Object.freeze({
        albumId,
        lloc,
        sloc,
        type,
        height,
        width,
        url,
        picBo,
        richval: `,${albumId},${lloc},${sloc},${type},${height},${width},,${height},${width}`
    })
}

export function publishMediaForm(
    account: string,
    photos: readonly UploadedPhoto[],
    videoIds: readonly string[]
) {
    const groups: { type: string; subtype: string; values: string[] }[] = []
    if (photos.length)
        groups.push({
            type: '1',
            subtype: '1',
            values: photos.map((photo) => photo.richval)
        })
    if (videoIds.length)
        groups.push({
            type: '3',
            subtype: '7',
            values: videoIds.map((vid) => {
                const play = encodeURIComponent(
                    `http://cache.tv.qq.com/qqplayerout.swf?v=${vid}&auto=0`
                )
                const detail = encodeURIComponent(
                    `http://user.qzone.qq.com/${account}/qzvideo/${vid}`
                )
                return `playurl=${play}&detailurl=${detail}&who=5&rich_flag=4&vid=${vid}`
            })
        })
    const bo = photos
        .map((photo) => photo.picBo)
        .filter(Boolean)
        .join(',')
    return {
        richval: groups.map((group) => group.values.join('\t')).join('\n'),
        ...(groups.length
            ? {
                  richtype: groups.map((group) => group.type).join('\n'),
                  subrichtype: groups.map((group) => group.subtype).join('\n')
              }
            : {}),
        ...(photos.length
            ? { pic_bo: groups.map(() => bo).join('\t'), pic_template: '' }
            : {})
    }
}

export function parsePublishReceipt(value: unknown): PublishReceipt {
    assertPayloadSuccess(value, 'post.publish')
    const records = payloadRecords(value)
    if (records.length === 0) {
        throw new QzoneParseError('动态发布响应格式异常', {
            context: { endpoint: 'post.publish' }
        })
    }
    const postId = firstText(records, ['fid', 'tid']) || null
    const message = firstText(records, ['msg', 'message'])
    return Object.freeze({
        postId,
        ...(message ? { message } : {})
    })
}

function firstText(
    records: readonly Readonly<Record<string, unknown>>[],
    keys: readonly string[]
): string {
    for (const record of records) {
        for (const key of keys) {
            if (!Object.hasOwn(record, key)) {
                continue
            }
            const value = record[key]
            if (
                typeof value === 'string' ||
                typeof value === 'number' ||
                typeof value === 'bigint'
            ) {
                const text = String(value).trim()
                if (text) {
                    return text
                }
            }
        }
    }
    return ''
}

function extractPicBo(value: string): string {
    const match = /(?:[?&]|!!)bo=([^!&#]*)/u.exec(value)
    if (!match?.[1]) {
        return ''
    }
    try {
        return decodeURIComponent(match[1])
    } catch {
        return match[1]
    }
}
