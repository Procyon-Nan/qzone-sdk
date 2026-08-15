import type { QzoneId } from '../types.js'
import { parseProtocolPost } from './post.js'
import type { ProtocolFeedPage } from './types.js'
import {
    asRecord,
    asRecords,
    firstRecord,
    firstValue,
    type ProtocolRecord,
    toBoolean,
    toText
} from './value.js'

const LIST_KEYS = [
    'vFeeds',
    'vfeeds',
    'msglist',
    'data',
    'feeds',
    'feedlist',
    'feedList'
] as const
const CURSOR_KEYS = [
    'attachinfo',
    'attach_info',
    'attachInfo',
    'attach',
    'externparam',
    'res_attach'
] as const
const HAS_MORE_KEYS = [
    'hasmore',
    'hasMore',
    'hasMoreFeeds',
    'has_more'
] as const
export function parseFeedPage(
    value: unknown,
    defaultAuthorId: QzoneId = ''
): ProtocolFeedPage {
    const page = normalizeFeedPage(value)
    const rawItems = extractRawItems(value, page)
    const items = rawItems.flatMap((raw) => {
        const parsed = parseProtocolPost(raw, defaultAuthorId)
        return parsed.id && parsed.authorId && !isIgnored(raw, parsed)
            ? [parsed]
            : []
    })
    const cursor = toText(firstValue(page, CURSOR_KEYS)).trim() || null
    return Object.freeze({
        items: Object.freeze(items),
        cursor,
        hasMore: toBoolean(firstValue(page, HAS_MORE_KEYS))
    })
}

function normalizeFeedPage(value: unknown): ProtocolRecord {
    if (Array.isArray(value)) {
        return { data: value }
    }
    const root = asRecord(value) ?? {}
    if (hasList(root)) {
        return root
    }
    const data = asRecord(root.data)
    if (data) {
        const nested = firstRecord(data, ['feedpage', 'main'])
        if (nested) {
            return nested
        }
        if (hasList(data)) {
            return data
        }
    }
    return firstRecord(root, ['feedpage', 'main']) ?? root
}

function extractRawItems(
    original: unknown,
    page: ProtocolRecord
): readonly ProtocolRecord[] {
    if (Array.isArray(original)) {
        return asRecords(original)
    }
    for (const key of LIST_KEYS) {
        const value = page[key]
        if (Array.isArray(value)) {
            return asRecords(value)
        }
        const record = asRecord(value)
        if (record) {
            const nested = extractRawItems(record, record)
            if (nested.length > 0) {
                return nested
            }
        }
    }
    return []
}

function hasList(value: ProtocolRecord): boolean {
    return LIST_KEYS.some((key) => Array.isArray(value[key]))
}

function isIgnored(
    raw: ProtocolRecord,
    post: ReturnType<typeof parseProtocolPost>
): boolean {
    const nickname = post.authorNickname.toLowerCase()
    return (
        post.action.appId === 6600 ||
        post.id.toLowerCase().startsWith('advertisement_') ||
        post.id.toLowerCase().startsWith('advertise_') ||
        post.id.toLowerCase().startsWith('ad_') ||
        post.authorId === '20050606' ||
        (post.action.appId === 5000 && nickname.includes('qzone')) ||
        toBoolean(raw.is_ad)
    )
}
