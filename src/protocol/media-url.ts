import { decodeHtmlEntities } from './html.js'
import { firstValue, type ProtocolRecord, toBoolean, toText } from './value.js'

export function normalizeRemoteUrl(value: unknown): string {
    let source = decodeHtmlEntities(toText(value)).trim().replaceAll('\\/', '/')
    if (source.startsWith('//')) {
        source = `https:${source}`
    }
    try {
        const url = new URL(source)
        return url.protocol === 'http:' || url.protocol === 'https:'
            ? source
            : ''
    } catch {
        return ''
    }
}

export function isNonImageRecord(record: ProtocolRecord): boolean {
    const raw = toText(firstValue(record, ['kind', 'type', 'media_type']))
        .trim()
        .toLowerCase()
    const mime = toText(
        firstValue(record, ['mime_type', 'content_type', 'mime'])
    ).toLowerCase()
    return (
        [
            'video',
            'movie',
            'audio',
            'music',
            'record',
            'voice',
            'file',
            'attachment'
        ].includes(raw) ||
        mime.startsWith('video/') ||
        mime.startsWith('audio/') ||
        mime.startsWith('application/') ||
        toBoolean(firstValue(record, ['is_video', 'isVideo']))
    )
}

export function mediaKind(
    record: ProtocolRecord,
    source: string
): 'image' | 'video' | 'audio' | 'file' {
    const raw = toText(firstValue(record, ['kind', 'type', 'media_type']))
        .trim()
        .toLowerCase()
    const mime = toText(
        firstValue(record, ['mime_type', 'content_type', 'mime'])
    ).toLowerCase()
    const name = mediaName(record, source).toLowerCase()
    if (
        toBoolean(firstValue(record, ['is_video', 'isVideo'])) ||
        ['video', 'movie'].includes(raw) ||
        mime.startsWith('video/')
    ) {
        return 'video'
    }
    if (
        ['audio', 'music', 'record', 'voice'].includes(raw) ||
        mime.startsWith('audio/')
    ) {
        return 'audio'
    }
    if (['image', 'photo', 'picture', 'pic'].includes(raw)) {
        return 'image'
    }
    if (/\.(?:mp4|m4v|mov|webm|m3u8)$/iu.test(name)) {
        return 'video'
    }
    if (/\.(?:mp3|m4a|aac|wav|ogg|flac)$/iu.test(name)) {
        return 'audio'
    }
    return 'file'
}

export function mediaName(record: ProtocolRecord, source: string): string {
    const explicit = toText(
        firstValue(record, [
            'name',
            'filename',
            'file_name',
            'fileName',
            'title'
        ])
    ).trim()
    if (explicit) {
        return explicit
    }
    try {
        return new URL(source).pathname.split('/').at(-1) ?? ''
    } catch {
        return ''
    }
}

export function photoIdentity(record: ProtocolRecord): string {
    const picId = toText(firstValue(record, ['pic_id', 'picId'])).trim()
    if (/^https?:/u.test(picId)) {
        return imageSourceKey(picId)
    }
    const album = toText(firstValue(record, ['albumid', 'albumId'])).trim()
    let location = toText(
        firstValue(record, ['lloc', 'realLloc', 'picid', 'picId'])
    ).trim()
    if (!location && picId) {
        location = picId.split(',').filter(Boolean).at(-1) ?? ''
    }
    return location ? `qzone-photo:${album}:${location}` : ''
}

export function imageSourceKey(source: string): string {
    try {
        const url = new URL(normalizeRemoteUrl(source))
        const marker = url.pathname.indexOf('/psc')
        if (marker >= 0) {
            const path = `${url.pathname.slice(marker)}${url.search}`
            const match = /\/psc\?\/(.+?)\/(?:m|b)(?:&|$)/u.exec(path)
            return `qzone-psc:${match?.[1] ?? path.split('&')[0]}`
        }
        return url.toString()
    } catch {
        return source
    }
}
