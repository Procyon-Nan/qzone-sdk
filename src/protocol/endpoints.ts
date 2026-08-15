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
    accountId: QzoneId
): TransportEndpoint {
    return Object.freeze({
        id,
        method: 'POST',
        url,
        operation: 'write',
        authentication: 'required',
        includeGtk: true,
        referer: `https://user.qzone.qq.com/${accountId}`,
        origin: 'https://user.qzone.qq.com',
        redirect: 'none'
    })
}
