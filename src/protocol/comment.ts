import type { QzoneComment } from '../types.js'
import { htmlToText } from './html.js'
import { extractCreatedAt } from './time.js'
import {
    asRecord,
    asRecordValues,
    asRecords,
    firstRecord,
    firstValue,
    type ProtocolRecord,
    toId,
    toText
} from './value.js'

const REPLY_KEYS = [
    'replyList',
    'replylist',
    'replies',
    'list_3',
    'children'
] as const
const COMMENT_KEYS = [
    'commentid',
    'commentId',
    'tid',
    'id',
    'uin',
    'commentUin',
    'content',
    'commentContent',
    'htmlContent',
    'text',
    'user',
    'userinfo',
    'commenter',
    ...REPLY_KEYS
] as const

export function parseComments(value: unknown): readonly QzoneComment[] {
    const payload = asRecord(value)
    if (!payload) {
        return []
    }
    const candidates: unknown[] = []
    const comment = asRecord(payload.comment)
    if (comment) {
        candidates.push(comment.comments, comment.commentlist, comment.list)
    }
    candidates.push(payload.comments, payload.commentlist, payload.list_3)
    const data = asRecord(payload.data)
    if (data) {
        candidates.push(data.comments, data.commentlist)
    }

    const result: QzoneComment[] = []
    const seen = new Set<string>()
    const append = (raw: ProtocolRecord, parentId: string | null): void => {
        const parsed = parseComment(raw, parentId)
        const key = `${parsed.id}\u0000${parsed.author.id}\u0000${parsed.content}`
        if (!seen.has(key)) {
            seen.add(key)
            result.push(parsed)
        }
        for (const replyKey of REPLY_KEYS) {
            for (const reply of commentRecords(raw[replyKey])) {
                append(reply, parsed.id || parentId)
            }
        }
    }

    for (const candidate of candidates) {
        for (const raw of commentRecords(candidate)) {
            append(raw, null)
        }
    }
    return Object.freeze(result)
}

function commentRecords(value: unknown): readonly ProtocolRecord[] {
    const records = asRecords(value)
    if (Array.isArray(value) || records.length === 0) {
        return records
    }
    const record = records[0]
    return record && COMMENT_KEYS.some((key) => Object.hasOwn(record, key))
        ? records
        : asRecordValues(record)
}

function parseComment(
    raw: ProtocolRecord,
    parentId: string | null
): QzoneComment {
    const user = firstRecord(raw, ['user', 'userinfo', 'commenter']) ?? {}
    const id = toText(
        firstValue(raw, ['commentid', 'commentId', 'tid', 'id'])
    ).trim()
    const authorId =
        toId(firstValue(raw, ['uin', 'commentUin'])) ||
        toId(firstValue(user, ['uin', 'user_id']))
    const nickname = htmlToText(
        toText(firstValue(user, ['nickname', 'name', 'uinname'])) ||
            toText(firstValue(raw, ['nickname', 'name']))
    )
    const content = htmlToText(
        toText(
            firstValue(raw, [
                'content',
                'commentContent',
                'htmlContent',
                'text'
            ])
        )
    )
    const declaredParent = toText(
        firstValue(raw, ['parentId', 'parent_tid'])
    ).trim()
    return Object.freeze({
        id,
        author: Object.freeze({ id: authorId, nickname }),
        content,
        createdAt: extractCreatedAt(raw),
        parentId: parentId ?? (declaredParent || null)
    })
}
