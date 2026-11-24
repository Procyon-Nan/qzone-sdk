import type { QzoneId } from '../types.js'
import type { TransportEndpoint } from '../transport/types.js'

const MOBILE_USER_AGENT =
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) ' +
    'AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Mobile Safari/537.36'

export function indexEndpoint(accountId: QzoneId): TransportEndpoint {
    return readEndpoint(
        'feed.index',
        'https://h5.qzone.qq.com/mqzone/index',
        `https://user.qzone.qq.com/${accountId}`,
        { userAgent: MOBILE_USER_AGENT }
    )
}

export function profileEndpoint(userId: QzoneId): TransportEndpoint {
    return readEndpoint(
        'feed.profile',
        'https://h5.qzone.qq.com/mqzone/profile',
        `https://user.qzone.qq.com/${userId}`,
        { userAgent: MOBILE_USER_AGENT }
    )
}

export function activeFeedsEndpoint(accountId: QzoneId): TransportEndpoint {
    return readEndpoint(
        'feed.active',
        'https://h5.qzone.qq.com/webapp/json/mqzone_feeds/getActiveFeeds',
        `https://user.qzone.qq.com/${accountId}`,
        { userAgent: MOBILE_USER_AGENT, tokenAccountId: accountId }
    )
}

export function profileFeedsEndpoint(userId: QzoneId): TransportEndpoint {
    return readEndpoint(
        'feed.profile.more',
        'https://mobile.qzone.qq.com/get_feeds',
        `https://user.qzone.qq.com/${userId}`,
        { userAgent: MOBILE_USER_AGENT, tokenAccountId: userId }
    )
}

export function legacyFeedsEndpoint(userId: QzoneId): TransportEndpoint {
    return readEndpoint(
        'feed.legacy',
        'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/emotion_cgi_msglist_v6',
        `https://user.qzone.qq.com/${userId}`,
        { origin: 'https://user.qzone.qq.com' }
    )
}

export function recentFeedsEndpoint(accountId: QzoneId): TransportEndpoint {
    return readEndpoint(
        'feed.recent',
        'https://user.qzone.qq.com/proxy/domain/ic2.qzone.qq.com/cgi-bin/feeds/feeds3_html_more',
        `https://user.qzone.qq.com/${accountId}`,
        { origin: 'https://user.qzone.qq.com' }
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
        { origin: 'https://user.qzone.qq.com' }
    )
}

export function h5DetailEndpoint(
    authorId: QzoneId,
    postId: QzoneId
): TransportEndpoint {
    return readEndpoint(
        'post.detail.h5',
        'https://h5.qzone.qq.com/webapp/json/mqzone_detail/shuoshuo',
        `https://user.qzone.qq.com/${authorId}/mood/${postId}`,
        { tokenAccountId: authorId }
    )
}

export function videoUploadEndpoint(checksum?: string): TransportEndpoint {
    const path = checksum ? 'FileBatchControl/' + checksum : 'FileUploadVideo'
    const origin = 'https://h5.qzone.qq.com'
    return {
        id: checksum ? 'post.video.control' : 'post.video.slice',
        method: 'POST',
        operation: 'write',
        authentication: 'required',
        url: origin + '/webapp/json/sliceUpload/' + path,
        origin,
        referer: origin + '/',
        redirect: 'none'
    }
}

export function videoIndexEndpoint(author: QzoneId): TransportEndpoint {
    return readEndpoint(
        'video.list',
        'https://user.qzone.qq.com/proxy/domain/taotao.qq.com/cgi-bin/video_get_data',
        'https://user.qzone.qq.com/' + author,
        { origin: 'https://user.qzone.qq.com' }
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
    options: Pick<
        TransportEndpoint,
        'origin' | 'userAgent' | 'tokenAccountId'
    > = {}
): TransportEndpoint {
    return Object.freeze({
        id,
        method: 'GET',
        url,
        operation: 'read',
        authentication: 'required',
        includeGtk: true,
        referer,
        ...options,
        redirect: 'qq'
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
