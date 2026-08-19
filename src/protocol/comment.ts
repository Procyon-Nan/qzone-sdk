import type { CommentReference, QzoneComment } from '../types.js'
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
    toInteger,
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
const ROOT_COUNT_KEYS = ['num', 'commentcount', 'total'] as const
const RAW_ROOT_COUNT_KEYS = ['cmtnum', 'commentnum'] as const
const REPLY_COUNT_KEYS = ['replynum', 'replyNum', 'reply_num'] as const

export interface ProtocolCommentSnapshot {
    readonly items: readonly QzoneComment[]
    readonly rootCount: number
    readonly reportedCount: number | null
    readonly complete: boolean
    readonly present: boolean
}

interface RootState {
    readonly expectedReplyCounts: number[]
    readonly replies: Set<string>
}

interface CommentSources {
    readonly candidates: readonly unknown[]
    readonly reportedCounts: readonly number[]
    readonly present: boolean
}

export function parseComments(value: unknown): readonly QzoneComment[] {
    return parseCommentSnapshot(value).items
}

export function parseCommentSnapshot(value: unknown): ProtocolCommentSnapshot {
    const payload = asRecord(value)
    if (!payload) {
        return emptySnapshot()
    }

    const { candidates, reportedCounts, present } =
        collectCommentSources(payload)
    const { items, roots } = parseCommentTree(candidates)
    const rootCount = roots.size
    const totalsComplete =
        reportedCounts.length > 0 &&
        reportedCounts.every((count) => count === rootCount)
    const repliesComplete = [...roots.values()].every(
        (state) =>
            state.expectedReplyCounts.length > 0 &&
            state.expectedReplyCounts.every(
                (count) => count === state.replies.size
            )
    )
    return Object.freeze({
        items: Object.freeze(items),
        rootCount,
        reportedCount:
            reportedCounts.length > 0 ? Math.max(...reportedCounts) : null,
        complete: totalsComplete && repliesComplete,
        present
    })
}

function collectCommentSources(payload: ProtocolRecord): CommentSources {
    const candidates: unknown[] = []
    const reportedCounts: number[] = []
    let present = false
    const collect = (record: ProtocolRecord, key: string): void => {
        if (Object.hasOwn(record, key)) {
            present = true
            candidates.push(record[key])
        }
    }

    const comment = asRecord(payload.comment)
    if (comment) {
        collect(comment, 'comments')
        collect(comment, 'commentlist')
        collect(comment, 'list')
        collectCounts(comment, ROOT_COUNT_KEYS, reportedCounts)
    }
    collect(payload, 'comments')
    collect(payload, 'commentlist')
    collect(payload, 'list_3')
    collectCounts(payload, RAW_ROOT_COUNT_KEYS, reportedCounts)
    if (
        Object.hasOwn(payload, 'total') &&
        (Object.hasOwn(payload, 'comments') ||
            Object.hasOwn(payload, 'commentlist'))
    ) {
        collectCounts(payload, ['total'], reportedCounts)
    }

    const data = asRecord(payload.data)
    if (data) {
        collect(data, 'comments')
        collect(data, 'commentlist')
        collectCounts(data, RAW_ROOT_COUNT_KEYS, reportedCounts)
        if (
            Object.hasOwn(data, 'total') &&
            (Object.hasOwn(data, 'comments') ||
                Object.hasOwn(data, 'commentlist'))
        ) {
            collectCounts(data, ['total'], reportedCounts)
        }
    }
    if (reportedCounts.length > 0) {
        present = true
    }

    return { candidates, reportedCounts, present }
}

function parseCommentTree(candidates: readonly unknown[]): {
    readonly items: QzoneComment[]
    readonly roots: Map<string, RootState>
} {
    const result: QzoneComment[] = []
    const seen = new Set<string>()
    const roots = new Map<string, RootState>()
    const append = (
        raw: ProtocolRecord,
        parent: CommentReference | null,
        threadRoot: CommentReference | null,
        kind: 'comment' | 'reply'
    ): void => {
        const parsed = parseComment(raw, parent, threadRoot, kind)
        const reference = commentReference(parsed)
        const key = reference ? commentKey(parsed) : null
        let childRoot = threadRoot

        if (reference && key) {
            if (kind === 'comment') {
                childRoot = reference
                const rootKey = referenceKey(reference)
                const state = roots.get(rootKey) ?? {
                    expectedReplyCounts: [],
                    replies: new Set<string>()
                }
                collectCounts(raw, REPLY_COUNT_KEYS, state.expectedReplyCounts)
                roots.set(rootKey, state)
            } else if (threadRoot) {
                roots.get(referenceKey(threadRoot))?.replies.add(key)
            }
            if (!seen.has(key)) {
                seen.add(key)
                result.push(parsed)
            }
        }

        const childParent = reference ?? parent
        for (const replyKey of REPLY_KEYS) {
            for (const reply of commentRecords(raw[replyKey])) {
                append(reply, childParent, childRoot, 'reply')
            }
        }
    }

    for (const candidate of candidates) {
        for (const raw of commentRecords(candidate)) {
            append(raw, null, null, 'comment')
        }
    }

    return { items: result, roots }
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
    parent: CommentReference | null,
    threadRoot: CommentReference | null,
    kind: 'comment' | 'reply'
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
        parentId: parent?.id ?? (declaredParent || null),
        threadRoot,
        // Observed legacy list_3 replies do not expose a reliable target author.
        // A structural container must not be promoted to an actual reply target.
        replyTo: null,
        kind
    })
}

function commentReference(comment: QzoneComment): CommentReference | null {
    return comment.id && comment.author.id
        ? Object.freeze({ id: comment.id, authorId: comment.author.id })
        : null
}

function referenceKey(reference: CommentReference): string {
    return `${reference.id}\u0000${reference.authorId}`
}

function commentKey(comment: QzoneComment): string {
    return [
        comment.kind,
        comment.threadRoot?.id ?? '',
        comment.threadRoot?.authorId ?? '',
        comment.id,
        comment.author.id
    ].join('\u0000')
}

function collectCounts(
    record: ProtocolRecord,
    keys: readonly string[],
    result: number[]
): void {
    for (const key of keys) {
        if (!Object.hasOwn(record, key)) {
            continue
        }
        const count = toInteger(record[key], -1)
        if (count >= 0) {
            result.push(count)
        }
    }
}

function emptySnapshot(): ProtocolCommentSnapshot {
    return Object.freeze({
        items: Object.freeze([]),
        rootCount: 0,
        reportedCount: null,
        complete: false,
        present: false
    })
}
