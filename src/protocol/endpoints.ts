import type { QzoneId } from '../types.js'
import type { TransportEndpoint } from '../transport/types.js'

export function indexEndpoint(accountId: QzoneId): TransportEndpoint {
    return readEndpoint(
        'feed.index',
        'https://h5.qzone.qq.com/mqzone/index',
        `https://user.qzone.qq.com/${accountId}`
    )
}

export function profileEndpoint(userId: QzoneId): TransportEndpoint {
    return readEndpoint(
        'feed.profile',
        'https://h5.qzone.qq.com/mqzone/profile',
        `https://user.qzone.qq.com/${userId}`
    )
}

export function activeFeedsEndpoint(accountId: QzoneId): TransportEndpoint {
    return tokenEndpoint(
        'feed.active',
        'https://h5.qzone.qq.com/webapp/json/mqzone_feeds/getActiveFeeds',
        accountId,
        `https://user.qzone.qq.com/${accountId}`
    )
}

export function profileFeedsEndpoint(userId: QzoneId): TransportEndpoint {
    return tokenEndpoint(
        'feed.profile.more',
        'https://mobile.qzone.qq.com/get_feeds',
        userId,
        `https://user.qzone.qq.com/${userId}`
    )
}

export function legacyFeedsEndpoint(userId: QzoneId): TransportEndpoint {
    return readEndpoint(
        'feed.legacy',
        'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6',
        `https://user.qzone.qq.com/${userId}`,
        'https://user.qzone.qq.com'
    )
}

export function recentFeedsEndpoint(accountId: QzoneId): TransportEndpoint {
    return readEndpoint(
        'feed.recent',
        'https://user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more',
        `https://user.qzone.qq.com/${accountId}`,
        'https://user.qzone.qq.com'
    )
}

export function legacyDetailEndpoint(
    authorId: QzoneId,
    postId: QzoneId
): TransportEndpoint {
    return readEndpoint(
        'post.detail.legacy',
        'https://h5.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msgdetail_v6',
        `https://user.qzone.qq.com/${authorId}/mood/${postId}`,
        'https://user.qzone.qq.com'
    )
}

export function h5DetailEndpoint(
    authorId: QzoneId,
    postId: QzoneId
): TransportEndpoint {
    return tokenEndpoint(
        'post.detail.h5',
        'https://h5.qzone.qq.com/webapp/json/mqzone_detail/shuoshuo',
        authorId,
        `https://user.qzone.qq.com/${authorId}/mood/${postId}`
    )
}

export function imageUploadEndpoint(accountId: QzoneId): TransportEndpoint {
    return writeEndpoint(
        'post.image.upload',
        'https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image',
        accountId
    )
}

export function publishPostEndpoint(accountId: QzoneId): TransportEndpoint {
    return writeEndpoint(
        'post.publish',
        'https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_publish_v6',
        accountId
    )
}

export function commentEndpoint(
    authorId: QzoneId,
    postId: QzoneId,
    reply = false
): TransportEndpoint {
    return writeEndpoint(
        reply ? 'comment.reply' : 'comment.create',
        reply
            ? 'https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds'
            : 'https://user.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_re_feeds',
        authorId,
        postId
    )
}

export function deletePostEndpoint(
    accountId: QzoneId,
    postId: QzoneId
): TransportEndpoint {
    return writeEndpoint(
        'post.delete',
        'https://h5.qzone.qq.com/proxy/domain/taotao.qzone.qq.com/cgi-bin/emotion_cgi_delete_v6',
        accountId,
        postId
    )
}

export function likePostEndpoints(
    authorId: QzoneId,
    postId: QzoneId,
    liked: boolean
): readonly TransportEndpoint[] {
    const action = liked ? 'like' : 'unlike'
    const path = liked ? 'internal_dolike_app' : 'internal_unlike_app'
    return Object.freeze([
        writeEndpoint(
            `post.${action}.proxy`,
            `https://user.qzone.qq.com/proxy/domain/w.qzone.qq.com/cgi-bin/likes/${path}`,
            authorId,
            postId,
            'qq-write-accepted',
            '/cgi-bin/likes/internal_'
        ),
        writeEndpoint(
            `post.${action}.direct`,
            `https://w.qzone.qq.com/cgi-bin/likes/${path}`,
            authorId,
            postId,
            'qq-write-accepted',
            '/cgi-bin/likes/internal_'
        )
    ])
}

function readEndpoint(
    id: string,
    url: string,
    referer: string,
    origin?: string
): TransportEndpoint {
    return Object.freeze({
        id,
        method: 'GET',
        url,
        operation: 'read',
        authentication: 'required',
        includeGtk: true,
        referer,
        ...(origin ? { origin } : {}),
        redirect: 'qq'
    })
}

function tokenEndpoint(
    id: string,
    url: string,
    tokenAccountId: QzoneId,
    referer: string
): TransportEndpoint {
    return Object.freeze({
        ...readEndpoint(id, url, referer),
        tokenAccountId
    })
}

function writeEndpoint(
    id: string,
    url: string,
    refererAccountId: QzoneId,
    postId?: QzoneId,
    redirect: TransportEndpoint['redirect'] = 'none',
    redirectFollowPath?: string
): TransportEndpoint {
    return Object.freeze({
        id,
        method: 'POST',
        url,
        operation: 'write',
        authentication: 'required',
        includeGtk: true,
        referer: postId
            ? `https://user.qzone.qq.com/${refererAccountId}/mood/${postId}`
            : `https://user.qzone.qq.com/${refererAccountId}`,
        origin: 'https://user.qzone.qq.com',
        redirect,
        ...(redirectFollowPath ? { redirectFollowPath } : {})
    })
}
