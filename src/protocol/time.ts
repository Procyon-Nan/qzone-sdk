import { extractHtmlAttribute, htmlToText } from './html.js'
import { asRecord, firstValue, type ProtocolRecord, toText } from './value.js'

const EXPLICIT_KEYS = [
    'time',
    'timeStr',
    'timestr',
    'time_text',
    'timeText',
    'abstime',
    'created_time',
    'createdTime',
    'created_at',
    'createdAt',
    'create_time',
    'createTime',
    'pubtime',
    'pub_time',
    'pubtimeText',
    'publish_time',
    'publishTime',
    'feedtime',
    'feedTime',
    'feedstime',
    'feedstimeText',
    'feedsTime',
    'feeds_time',
    'opertime',
    'operTime',
    'uploadtime',
    'uploadTime',
    'addtime',
    'addTime',
    'ctime'
] as const
const GENERIC_KEYS = ['timestamp', 'date'] as const
const CONTAINER_KEYS = [
    'data',
    'common',
    'comm',
    'cell_comm',
    'cellComm',
    'feed',
    'feedInfo',
    'original',
    'summary',
    'operation',
    'cell',
    'cell_summary',
    'cellSummary'
] as const
const MARKUP_KEYS = [
    'html',
    'htmlContent',
    'html_content',
    'contentHtml',
    'content_html',
    'content',
    'summary'
] as const
const ATTRIBUTE_KEYS = [
    'data-time',
    'data-abstime',
    'data-pubtime',
    'data-timestamp',
    'data-created-at',
    'data-created-time',
    'time',
    'abstime',
    'pubtime',
    'timestamp'
] as const
const MIN_SECONDS = 1_100_000_000
const MAX_SECONDS = 4_102_444_800

export function parseQzoneTimestamp(value: unknown): string | null {
    const numeric = normalizeSeconds(value)
    if (numeric !== null) {
        return new Date(numeric * 1_000).toISOString()
    }
    const text = htmlToText(toText(value)).replace(/\s+/gu, ' ').trim()
    const match =
        /(?<year>20\d{2})[年/-](?<month>\d{1,2})[月/-](?<day>\d{1,2})日?\s+(?<hour>\d{1,2}):(?<minute>\d{2})(?::(?<second>\d{2}))?/u.exec(
            text
        )
    if (!match?.groups) {
        return null
    }
    const { year, month, day, hour, minute, second = '0' } = match.groups
    if (!year || !month || !day || !hour || !minute) {
        return null
    }
    const yearNumber = Number(year)
    const monthNumber = Number(month)
    const dayNumber = Number(day)
    const hourNumber = Number(hour)
    const minuteNumber = Number(minute)
    const secondNumber = Number(second)
    const localTimestamp = Date.UTC(
        yearNumber,
        monthNumber - 1,
        dayNumber,
        hourNumber,
        minuteNumber,
        secondNumber
    )
    const localDate = new Date(localTimestamp)
    if (
        localDate.getUTCFullYear() !== yearNumber ||
        localDate.getUTCMonth() !== monthNumber - 1 ||
        localDate.getUTCDate() !== dayNumber ||
        localDate.getUTCHours() !== hourNumber ||
        localDate.getUTCMinutes() !== minuteNumber ||
        localDate.getUTCSeconds() !== secondNumber
    ) {
        return null
    }
    return new Date(localTimestamp - 8 * 60 * 60 * 1_000).toISOString()
}

export function extractCreatedAt(value: unknown): string | null {
    const root = asRecord(value)
    if (!root) {
        return null
    }
    const sources = collectSources(root)
    for (const keys of [EXPLICIT_KEYS, GENERIC_KEYS]) {
        for (const source of sources) {
            const timestamp = parseQzoneTimestamp(firstValue(source, keys))
            if (timestamp) {
                return timestamp
            }
        }
    }
    for (const source of sources) {
        for (const key of MARKUP_KEYS) {
            const markup = toText(source[key])
            for (const attribute of ATTRIBUTE_KEYS) {
                const timestamp = parseQzoneTimestamp(
                    extractHtmlAttribute(markup, attribute)
                )
                if (timestamp) {
                    return timestamp
                }
            }
        }
    }
    return null
}

function collectSources(root: ProtocolRecord): readonly ProtocolRecord[] {
    const result: ProtocolRecord[] = []
    const seen = new Set<ProtocolRecord>()
    const add = (record: ProtocolRecord, depth: number): void => {
        if (seen.has(record)) {
            return
        }
        seen.add(record)
        result.push(record)
        if (depth === 0) {
            return
        }
        for (const key of CONTAINER_KEYS) {
            const child = asRecord(record[key])
            if (child) {
                add(child, depth - 1)
            }
        }
    }
    add(root, 2)
    return result
}

function normalizeSeconds(value: unknown): number | null {
    let timestamp = Number(toText(value).trim())
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
        return null
    }
    while (timestamp > 10_000_000_000) {
        timestamp = Math.trunc(timestamp / 1_000)
    }
    timestamp = Math.trunc(timestamp)
    return timestamp >= MIN_SECONDS && timestamp <= MAX_SECONDS
        ? timestamp
        : null
}
