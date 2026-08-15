import type { QzoneMedia } from '../types.js'
import { extractHtmlAttribute } from './html.js'
import {
    isNonImageRecord,
    mediaKind,
    mediaName,
    imageSourceKey,
    normalizeRemoteUrl,
    photoIdentity
} from './media-url.js'
import { extractAuthorId, extractPostId } from './post-fields.js'
import {
    asRecord,
    firstValue,
    type ProtocolRecord,
    toInteger,
    toText
} from './value.js'

const IMAGE_CONTAINERS = [
    'images',
    'image',
    'pics',
    'pic',
    'picdata',
    'picData',
    'cell_pic',
    'cellPic',
    'photos',
    'photo',
    'photoList',
    'photolist',
    'picList',
    'piclist',
    'imageList',
    'imagelist',
    'media',
    'medias'
] as const
const ATTACHMENT_CONTAINERS = [
    'attachments',
    'attachment',
    'files',
    'file_list',
    'fileList',
    'audio',
    'audios',
    'music',
    'musics',
    'video',
    'videos',
    'media',
    'medias'
] as const
const NESTED_CONTAINERS = [
    'data',
    'feed',
    'entry',
    'original',
    'content',
    'summary',
    'cell',
    'cell_summary',
    'cellSummary'
] as const
const IMAGE_SOURCE_KEYS = [
    'url3',
    'origin_url',
    'originUrl',
    'original_url',
    'originalUrl',
    'largeurl',
    'largeUrl',
    'url2',
    'pic_url',
    'picUrl',
    'photo_url',
    'photoUrl',
    'image_url',
    'imageUrl',
    'url',
    'url1',
    'pre',
    'sloc',
    'smallurl',
    'smallUrl',
    'thumb',
    'thumbnail',
    'cover',
    'coverUrl'
] as const
const MEDIA_SOURCE_KEYS = [
    'download_url',
    'downloadUrl',
    'play_url',
    'playUrl',
    'video_url',
    'videoUrl',
    'audio_url',
    'audioUrl',
    'media_url',
    'mediaUrl',
    'file_url',
    'fileUrl',
    'source',
    ...IMAGE_SOURCE_KEYS
] as const
const MARKUP_KEYS = [
    'html',
    'htmlContent',
    'contentHtml',
    'content',
    'summary'
] as const

interface MediaTarget {
    readonly postId: string
    readonly authorId: string
}

interface MediaCollector {
    readonly result: QzoneMedia[]
    readonly add: (media: QzoneMedia, identity?: string) => void
}

export function parseMedia(
    value: unknown,
    target: MediaTarget
): readonly QzoneMedia[] {
    const root = asRecord(value)
    if (!root) {
        return []
    }
    const collector = createCollector()

    const walkImages = (node: unknown, depth: number): void => {
        if (depth < 0) {
            return
        }
        if (typeof node === 'string') {
            for (const source of extractMarkupImages(node)) {
                if (isPostImage(source)) {
                    collector.add({ kind: 'image', url: source })
                }
            }
            return
        }
        for (const record of nodeRecords(node)) {
            if (!belongsTo(record, target)) {
                continue
            }
            const videoInfo = asRecord(record.video_info ?? record.videoInfo)
            if (videoInfo) {
                const source = mediaSource(videoInfo)
                if (source) {
                    const previewUrl = imageSource(record)
                    const durationMs = toInteger(
                        firstValue(videoInfo, ['video_time', 'duration'])
                    )
                    const videoId = toText(
                        firstValue(videoInfo, ['video_id', 'videoId'])
                    ).trim()
                    collector.add({
                        kind: 'video',
                        url: source,
                        name: `${videoId || 'qzone-video'}.mp4`,
                        mimeType: 'video/mp4',
                        ...(previewUrl ? { previewUrl } : {}),
                        ...(durationMs > 0 ? { durationMs } : {})
                    })
                    continue
                }
            }
            if (isNonImageRecord(record)) {
                continue
            }
            const source = imageSource(record)
            if (source && isPostImage(source)) {
                const width = toInteger(
                    firstValue(record, ['origin_width', 'width'])
                )
                const height = toInteger(
                    firstValue(record, ['origin_height', 'height'])
                )
                collector.add(
                    {
                        kind: 'image',
                        url: source,
                        ...(width > 0 ? { width } : {}),
                        ...(height > 0 ? { height } : {})
                    },
                    photoIdentity(record) || undefined
                )
            }
            if (depth === 0) {
                continue
            }
            for (const key of [...IMAGE_CONTAINERS, ...NESTED_CONTAINERS]) {
                const child = record[key]
                if (child !== undefined) {
                    walkImages(child, depth - 1)
                }
            }
            for (const key of MARKUP_KEYS) {
                walkImages(record[key], depth - 1)
            }
            for (const child of Object.values(record)) {
                if (typeof child === 'object' && child !== null) {
                    walkImages(child, depth - 1)
                }
            }
        }
    }

    for (const key of IMAGE_CONTAINERS) {
        walkImages(root[key], 4)
    }
    for (const key of NESTED_CONTAINERS) {
        walkImages(root[key], 3)
    }
    for (const key of MARKUP_KEYS) {
        walkImages(root[key], 1)
    }

    const walkAttachments = (node: unknown, depth: number): void => {
        if (depth < 0) {
            return
        }
        for (const record of nodeRecords(node)) {
            if (!belongsTo(record, target)) {
                continue
            }
            const source = mediaSource(record)
            const kind = source ? mediaKind(record, source) : null
            if (source && kind && kind !== 'image') {
                const name = mediaName(record, source)
                const mimeType = toText(
                    firstValue(record, ['mime_type', 'content_type', 'mime'])
                ).trim()
                const size = toInteger(
                    firstValue(record, ['size', 'file_size', 'fileSize'])
                )
                const durationMs = toInteger(
                    firstValue(record, ['duration_ms', 'duration'])
                )
                collector.add({
                    kind,
                    url: source,
                    ...(name ? { name } : {}),
                    ...(mimeType ? { mimeType } : {}),
                    ...(size > 0 ? { size } : {}),
                    ...(kind !== 'file' && durationMs > 0 ? { durationMs } : {})
                })
            }
            for (const key of ATTACHMENT_CONTAINERS) {
                walkAttachments(record[key], depth - 1)
            }
            for (const child of Object.values(record)) {
                if (typeof child === 'object' && child !== null) {
                    walkAttachments(child, depth - 1)
                }
            }
        }
    }
    for (const key of ATTACHMENT_CONTAINERS) {
        walkAttachments(root[key], 4)
    }
    return Object.freeze(collector.result)
}

function nodeRecords(value: unknown): readonly ProtocolRecord[] {
    if (Array.isArray(value)) {
        return value.flatMap((item) => {
            const record = asRecord(item)
            return record ? [record] : []
        })
    }
    const record = asRecord(value)
    return record ? [record] : []
}

function createCollector(): MediaCollector {
    const result: QzoneMedia[] = []
    const seen = new Set<string>()
    const seenSources = new Set<string>()
    return {
        result,
        add: (media, identity) => {
            const key = `${media.kind}:${identity ?? imageSourceKey(media.url)}`
            const sourceKey = `${media.kind}:${imageSourceKey(media.url)}`
            if (!seen.has(key) && !seenSources.has(sourceKey)) {
                seen.add(key)
                seenSources.add(sourceKey)
                result.push(Object.freeze(media))
            }
        }
    }
}

function imageSource(record: ProtocolRecord): string {
    const photoUrls = asRecord(record.photourl)
    if (photoUrls) {
        for (const key of ['1', '0', '14', '11', '2', '3']) {
            const item = asRecord(photoUrls[key])
            const source = normalizeRemoteUrl(item?.url ?? photoUrls[key])
            if (source) {
                return source
            }
        }
    }
    for (const key of IMAGE_SOURCE_KEYS) {
        const source = normalizeRemoteUrl(record[key])
        if (source) {
            return source
        }
    }
    return ''
}

function mediaSource(record: ProtocolRecord): string {
    for (const key of MEDIA_SOURCE_KEYS) {
        const source = normalizeRemoteUrl(record[key])
        if (source) {
            return source
        }
    }
    return ''
}

function isPostImage(source: string): boolean {
    const normalized = source.toLowerCase()
    return !(
        normalized.includes('qlogo') ||
        normalized.includes('/qzone/em/') ||
        normalized.includes('/qz_em/') ||
        normalized.includes('/club/item/parcel/')
    )
}

function extractMarkupImages(markup: string): readonly string[] {
    const result: string[] = []
    for (const match of markup.matchAll(/<img\b[^>]*>/giu)) {
        for (const attribute of [
            'src',
            'data-src',
            'data-original',
            'origin-src',
            'original-src'
        ]) {
            const source = normalizeRemoteUrl(
                extractHtmlAttribute(match[0], attribute)
            )
            if (source) {
                result.push(source)
                break
            }
        }
    }
    return result
}

function belongsTo(record: ProtocolRecord, target: MediaTarget): boolean {
    const postId = extractPostId(record)
    if (postId && target.postId && postId !== target.postId) {
        return false
    }
    const authorId = extractAuthorId(record)
    return !(authorId && target.authorId && authorId !== target.authorId)
}
