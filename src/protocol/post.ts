import type { QzoneId } from '../types.js'
import { parseComments } from './comment.js'
import { extractCreatedAt } from './time.js'
import type { ProtocolPost } from './types.js'
import { parseMedia } from './media.js'
import {
    asRecord,
    asRecords,
    firstRecord,
    firstValue,
    type ProtocolRecord,
    toBoolean,
    toInteger,
    toText
} from './value.js'
import {
    extractAuthorId,
    extractContent,
    extractMarkupAttribute,
    extractNickname,
    extractPostId,
    normalizeUrl
} from './post-fields.js'

const DETAIL_CONTAINER_KEYS = [
    'data',
    'feed',
    'feeds',
    'feedinfo',
    'feedInfo',
    'item',
    'items',
    'msg',
    'msglist',
    'cell',
    'cells',
    'shuoshuo'
] as const

export function parseProtocolPost(
    value: unknown,
    defaultAuthorId: QzoneId = ''
): ProtocolPost {
    const raw = asRecord(value) ?? {}
    const common =
        firstRecord(raw, ['common', 'comm', 'cell_comm', 'cellComm']) ?? {}
    const user =
        firstRecord(raw, [
            'userinfo',
            'cell_userinfo',
            'cellUserInfo',
            'user'
        ]) ?? {}
    const like = firstRecord(raw, ['like']) ?? {}
    const comment = firstRecord(raw, ['comment']) ?? {}
    const operation = firstRecord(raw, ['operation', 'cell_operation']) ?? {}
    const authorId = extractAuthorId(raw) || defaultAuthorId
    const id = extractPostId(raw)
    const appId =
        toInteger(common.appid) ||
        toInteger(raw.appid) ||
        toInteger(extractMarkupAttribute(raw, 'data-appid')) ||
        311
    const createdAt = extractCreatedAt(raw)
    const comments = parseComments(raw)
    const commentCount = Math.max(
        toInteger(firstValue(comment, ['num', 'commentcount'])),
        toInteger(firstValue(raw, ['cmtnum', 'commentnum'])),
        asRecords(raw.commentlist).length,
        comments.length
    )
    const fallbackKey = computePostUrl(appId, authorId, id)
    const businessParameters = asRecord(operation.busi_param) ?? {}
    const authorAvatarUrl = normalizeUrl(
        firstValue(user, ['avatar', 'avatarUrl', 'figureurl', 'logimg']) ??
            raw.logimg
    )
    return Object.freeze({
        id,
        authorId,
        authorNickname: extractNickname(raw, user, authorId),
        ...(authorAvatarUrl ? { authorAvatarUrl } : {}),
        content: extractContent(raw),
        createdAt,
        likeCount:
            toInteger(firstValue(like, ['num', 'likeNum', 'count'])) ||
            toInteger(firstValue(raw, ['likeNum', 'likenum', 'like_num'])),
        commentCount,
        liked: toBoolean(
            firstValue(like, ['isliked', 'ismylike', 'isLike', 'islike']) ??
                firstValue(raw, ['isliked', 'liked'])
        ),
        media: parseMedia(raw, { postId: id, authorId }),
        comments,
        action: Object.freeze({
            appId,
            currentLikeKey:
                toText(firstValue(raw, ['curkey', 'curlikekey'])).trim() ||
                toText(firstValue(common, ['curkey', 'curlikekey'])).trim() ||
                fallbackKey,
            unlikeKey:
                toText(firstValue(raw, ['unikey', 'unlikekey'])).trim() ||
                toText(firstValue(common, ['unikey', 'unlikekey'])).trim() ||
                fallbackKey,
            topicId:
                appId === 311
                    ? `${authorId}_${id}__1`
                    : `${authorId}_${createdAt ? Date.parse(createdAt) / 1_000 : ''}`,
            businessParameters: Object.freeze({ ...businessParameters })
        })
    })
}

export function mergeProtocolPost(
    listPost: ProtocolPost,
    detail: unknown
): ProtocolPost {
    const raw = asRecord(detail) ?? {}
    const detailPost = parseProtocolPost(raw, listPost.authorId)
    const detailMedia = parseMedia(raw, {
        postId: listPost.id,
        authorId: listPost.authorId
    })
    const common = firstRecord(raw, ['common', 'comm', 'cell_comm', 'cellComm'])
    const operation = firstRecord(raw, ['operation', 'cell_operation'])
    const hasAppId = hasAnyKey(raw, ['appid']) || hasAnyKey(common, ['appid'])
    const action = Object.freeze({
        appId: hasAppId ? detailPost.action.appId : listPost.action.appId,
        currentLikeKey:
            hasAnyKey(raw, ['curkey', 'curlikekey']) ||
            hasAnyKey(common, ['curkey', 'curlikekey'])
                ? detailPost.action.currentLikeKey
                : listPost.action.currentLikeKey,
        unlikeKey:
            hasAnyKey(raw, ['unikey', 'unlikekey']) ||
            hasAnyKey(common, ['unikey', 'unlikekey'])
                ? detailPost.action.unlikeKey
                : listPost.action.unlikeKey,
        topicId:
            hasAppId || extractCreatedAt(raw) !== null
                ? detailPost.action.topicId
                : listPost.action.topicId,
        businessParameters: hasAnyKey(operation, ['busi_param'])
            ? detailPost.action.businessParameters
            : listPost.action.businessParameters
    })
    return Object.freeze({
        ...listPost,
        authorNickname: detailPost.authorNickname || listPost.authorNickname,
        ...(detailPost.authorAvatarUrl || listPost.authorAvatarUrl
            ? {
                  authorAvatarUrl:
                      detailPost.authorAvatarUrl ?? listPost.authorAvatarUrl
              }
            : {}),
        content: detailPost.content || listPost.content,
        createdAt: detailPost.createdAt ?? listPost.createdAt,
        likeCount: hasLikeCount(raw)
            ? detailPost.likeCount
            : listPost.likeCount,
        commentCount: Math.max(detailPost.commentCount, listPost.commentCount),
        liked: hasLiked(raw) ? detailPost.liked : listPost.liked,
        media: detailMedia.length > 0 ? detailMedia : listPost.media,
        comments:
            detailPost.comments.length > 0
                ? detailPost.comments
                : listPost.comments,
        action
    })
}

export function findPostDetail(
    value: unknown,
    target: { readonly id: QzoneId; readonly authorId: QzoneId }
): ProtocolRecord | null {
    const visited = new Set<object>()

    const visit = (node: unknown, depth: number): ProtocolRecord | null => {
        if (depth < 0 || typeof node !== 'object' || node === null) {
            return null
        }
        if (visited.has(node)) {
            return null
        }
        visited.add(node)

        if (Array.isArray(node)) {
            for (const item of node.slice(0, 100)) {
                const found = visit(item, depth - 1)
                if (found) {
                    return found
                }
            }
            return null
        }

        const record = asRecord(node)
        if (!record) {
            return null
        }
        const postId = extractPostId(record)
        const authorId = extractAuthorId(record)
        if (
            postId === target.id &&
            (!authorId || authorId === target.authorId)
        ) {
            return record
        }
        for (const key of DETAIL_CONTAINER_KEYS) {
            const found = visit(record[key], depth - 1)
            if (found) {
                return found
            }
        }
        return null
    }

    const exact = visit(value, 6)
    if (exact) {
        return exact
    }

    let candidate = asRecord(value)
    for (let depth = 0; candidate && depth < 3; depth += 1) {
        const nested = asRecord(candidate.data)
        if (!nested) {
            break
        }
        candidate = nested
    }
    return candidate &&
        !extractPostId(candidate) &&
        looksLikePostDetail(candidate) &&
        !DETAIL_CONTAINER_KEYS.some((key) => Object.hasOwn(candidate, key))
        ? candidate
        : null
}

function computePostUrl(appId: number, authorId: string, id: string): string {
    if (!authorId || !id) {
        return ''
    }
    return appId === 311
        ? `https://user.qzone.qq.com/${authorId}/mood/${id}`
        : `https://user.qzone.qq.com/${authorId}/app/${appId}/${id}`
}

function hasLikeCount(raw: ProtocolRecord): boolean {
    const like = firstRecord(raw, ['like'])
    return (
        hasAnyKey(like, ['num', 'likeNum', 'count']) ||
        hasAnyKey(raw, ['likeNum', 'likenum', 'like_num'])
    )
}

function hasLiked(raw: ProtocolRecord): boolean {
    const like = firstRecord(raw, ['like'])
    return (
        hasAnyKey(like, ['isliked', 'ismylike', 'isLike', 'islike']) ||
        hasAnyKey(raw, ['isliked', 'liked'])
    )
}

function hasAnyKey(
    record: ProtocolRecord | null,
    keys: readonly string[]
): boolean {
    return record !== null && keys.some((key) => Object.hasOwn(record, key))
}

function looksLikePostDetail(record: ProtocolRecord): boolean {
    return [
        'content',
        'con',
        'summary',
        'cell_summary',
        'commentlist',
        'comments',
        'like',
        'pic',
        'pics'
    ].some((key) => Object.hasOwn(record, key))
}
