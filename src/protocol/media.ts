import type { QzoneMedia } from '../types.js'
import { extractHtmlAttribute } from './html.js'
import {
    ATTACHMENT_SOURCE_KEYS,
    isNonImageRecord,
    mediaKind,
    mediaName,
    imageSourceKey,
    normalizeRemoteUrl,
    photoIdentity
} from './media-url.js'
import { extractPostId, resolvePostAuthor } from './post-fields.js'
import {
    asRecord,
    asRecords,
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
const VIDEO_SOURCE_KEYS = [...ATTACHMENT_SOURCE_KEYS, 'url3', 'url']
const MEDIA_SOURCE_KEYS = [...ATTACHMENT_SOURCE_KEYS, ...IMAGE_SOURCE_KEYS]
const MARKUP_KEYS = [
    'html',
    'htmlContent',
    'contentHtml',
    'content',
    'summary'
] as const

const ATTACHMENT_CHILDREN = new Set<string>(ATTACHMENT_CONTAINERS)
const IMAGE_CHILDREN = new Set<string>([
    ...IMAGE_CONTAINERS,
    ...NESTED_CONTAINERS,
    ...MARKUP_KEYS
])

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

    // A video owns both its covers and its playback variants. Neither walker descends into it.
    function collectVideo(record: ProtocolRecord): boolean {
        const info = asRecord(record.video_info ?? record.videoInfo)
        let url: string
        let previewUrl: string
        if (info) {
            url = mediaSource(info, VIDEO_SOURCE_KEYS)
            if (!url) {
                const alternate = mediaSource(info)
                if (alternate && mediaKind({}, alternate) === 'video')
                    url = alternate
            }
            previewUrl = imageSource(record)
        } else if ('videourl' in record || 'videourls' in record) {
            url =
                normalizeRemoteUrl(record.videourl) ||
                variantUrl(record.videourls)
            previewUrl = variantUrl(record.coverurl)
        } else if (
            'video_id' in record &&
            ('url3' in record || 'url1' in record || 'pic_url' in record)
        ) {
            url = normalizeRemoteUrl(record.url3)
            previewUrl =
                photoVariantUrl(record.pic_url) || photoVariantUrl(record.url1)
        } else {
            return false
        }
        if (!url) return true
        const metadata = info ?? record
        const durationMs = toInteger(
            firstValue(metadata, ['video_time', 'duration'])
        )
        const id = toText(
            firstValue(metadata, ['video_id', 'videoId', 'videoid'])
        )
        const mp4 = /\.mp4$/iu.test(new URL(url).pathname)
            ? { name: `${id || 'qzone-video'}.mp4`, mimeType: 'video/mp4' }
            : {}
        collector.add({
            kind: 'video',
            url,
            ...mp4,
            ...(previewUrl ? { previewUrl } : {}),
            ...(durationMs > 0 ? { durationMs } : {})
        })
        return true
    }

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
        for (const record of asRecords(node)) {
            if (!belongsTo(record, target)) {
                continue
            }
            if (collectVideo(record)) continue
            if (isNonImageRecord(record)) {
                continue
            }
            const source = imageSource(record)
            if (source) {
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
            for (const child of mediaChildren(record, IMAGE_CHILDREN)) {
                walkImages(child, depth - 1)
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
        for (const record of asRecords(node)) {
            if (!belongsTo(record, target)) {
                continue
            }
            if (collectVideo(record)) continue
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
            for (const child of mediaChildren(record, ATTACHMENT_CHILDREN)) {
                walkAttachments(child, depth - 1)
            }
        }
    }
    for (const key of ATTACHMENT_CONTAINERS) {
        walkAttachments(root[key], 4)
    }
    return Object.freeze(collector.result)
}

function* mediaChildren(
    record: ProtocolRecord,
    containers: ReadonlySet<string>
) {
    for (const key of containers) {
        if (record[key] !== undefined) yield record[key]
    }
    for (const [key, child] of Object.entries(record)) {
        if (
            !containers.has(key) &&
            key !== 'photourl' &&
            key !== 'coverurl' &&
            typeof child === 'object' &&
            child !== null
        ) {
            yield child
        }
    }
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
    const photoUrls = variantTable(record.photourl)
    if (photoUrls) {
        for (const key of [1, 0, 14, 11, 2, 3]) {
            const source = photoVariantUrl(photoUrls[key])
            if (source) {
                return source
            }
        }
    }
    for (const key of IMAGE_SOURCE_KEYS) {
        const source = normalizeRemoteUrl(record[key])
        if (source && isPostImage(source)) {
            return source
        }
    }
    for (const variant of Object.values(photoUrls ?? {})) {
        const source = photoVariantUrl(variant)
        if (source) {
            return source
        }
    }
    return ''
}

function photoVariantUrl(variant: unknown): string {
    const url = normalizeRemoteUrl(asRecord(variant)?.url ?? variant)
    return isPostImage(url) ? url : ''
}

function variantTable(
    value: unknown
): Readonly<Record<number, unknown>> | null {
    return Array.isArray(value) ? value : asRecord(value)
}

function variantUrl(variants: unknown): string {
    for (const item of Object.values(variantTable(variants) ?? {})) {
        const url = normalizeRemoteUrl(asRecord(item)?.url)
        if (url) return url
    }
    return ''
}

function mediaSource(
    record: ProtocolRecord,
    keys: readonly string[] = MEDIA_SOURCE_KEYS
): string {
    for (const key of keys) {
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
    const authorId = resolvePostAuthor(record).id
    return !(authorId && target.authorId && authorId !== target.authorId)
}
