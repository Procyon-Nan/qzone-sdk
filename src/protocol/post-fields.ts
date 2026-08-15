import { extractClassText, extractHtmlAttribute, htmlToText } from './html.js'
import {
    asRecord,
    firstRecord,
    firstValue,
    type ProtocolRecord,
    toId,
    toText
} from './value.js'

const HTML_KEYS = [
    'html',
    'htmlContent',
    'html_content',
    'contentHtml',
    'content_html'
] as const

export function extractPostId(raw: ProtocolRecord): string {
    const common = firstRecord(raw, ['common', 'comm', 'cell_comm', 'cellComm'])
    const values = [
        firstValue(raw, ['fid', 'tid', 'cellid', 'feedid', 'feedId']),
        firstRecord(raw, ['id', 'cell_id', 'cellId'])?.cellid,
        common?.ugcrightkey,
        common?.ugckey,
        firstValue(raw, ['ugcrightkey', 'ugckey', 'key']),
        extractMarkupAttribute(raw, 'data-fid'),
        extractMarkupAttribute(raw, 'data-tid'),
        extractMarkupAttribute(raw, 'data-cellid')
    ]
    for (const value of values) {
        const text = toText(value).trim()
        if (text) {
            return /^\d+_\d+_[^_]+_?$/u.test(text)
                ? (text.split('_')[2] ?? text)
                : text
        }
    }
    return ''
}

export function extractAuthorId(raw: ProtocolRecord): string {
    const user = firstRecord(raw, [
        'userinfo',
        'cell_userinfo',
        'cellUserInfo',
        'user'
    ])
    for (const value of [
        firstValue(raw, [
            'uin',
            'opuin',
            'owneruin',
            'ownerUin',
            'fuin',
            'hostuin',
            'hostUin'
        ]),
        user?.uin,
        extractMarkupAttribute(raw, 'data-uin'),
        extractMarkupAttribute(raw, 'data-opuin')
    ]) {
        const id = toId(value)
        if (id) {
            return id
        }
    }
    return ''
}

export function extractContent(raw: ProtocolRecord): string {
    const original = asRecord(raw.original)
    for (const value of [
        raw.content,
        raw.con,
        asRecord(raw.summary)?.summary,
        asRecord(raw.cell_summary)?.summary,
        asRecord(raw.cellSummary)?.summary,
        raw.summary,
        raw.cell_summary,
        raw.cellSummary,
        asRecord(original?.summary)?.summary,
        raw.text
    ]) {
        const content = htmlToText(toText(value))
        if (content) {
            return content
        }
    }
    for (const key of HTML_KEYS) {
        const content = extractClassText(toText(raw[key]), 'f-info')
        if (content) {
            return content
        }
    }
    return ''
}

export function extractNickname(
    raw: ProtocolRecord,
    user: ProtocolRecord,
    authorId: string
): string {
    for (const value of [
        firstValue(raw, ['name', 'nickname']),
        firstValue(user, ['nickname', 'nickName', 'name', 'uinname'])
    ]) {
        const nickname = htmlToText(toText(value)).trim()
        if (nickname && nickname !== authorId && !/^\d{5,}$/u.test(nickname)) {
            return nickname
        }
    }
    return ''
}

export function extractMarkupAttribute(
    raw: ProtocolRecord,
    attribute: string
): string {
    for (const key of HTML_KEYS) {
        const value = extractHtmlAttribute(toText(raw[key]), attribute)
        if (value) {
            return value
        }
    }
    return ''
}

export function normalizeUrl(value: unknown): string {
    const text = toText(value).trim()
    const source = text.startsWith('//') ? `https:${text}` : text
    try {
        const url = new URL(source)
        return ['http:', 'https:'].includes(url.protocol) ? source : ''
    } catch {
        return ''
    }
}
