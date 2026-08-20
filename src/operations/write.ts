import {
    QzoneParseError,
    QzoneRequestError,
    QzoneValidationError
} from '../errors.js'
import {
    commentEndpoint,
    deletePostEndpoint,
    imageUploadEndpoint,
    likePostEndpoints,
    publishPostEndpoint
} from '../protocol/endpoints.js'
import type { PreparedPublishImage } from '../protocol/image.js'
import {
    parseMutationReceipt,
    type MutationReceipt
} from '../protocol/mutation.js'
import {
    parsePublishReceipt,
    parseUploadedPhoto,
    type PublishReceipt,
    type UploadedPhoto
} from '../protocol/publish.js'
import type { SessionState } from '../session/session.js'
import type { CommentReference } from '../types.js'
import {
    FetchTransport,
    UncertainTransportError
} from '../transport/fetch-transport.js'
import { parseResponseData } from '../transport/response.js'
import type { TransportEndpoint } from '../transport/types.js'
import type { ProtocolPost } from '../protocol/types.js'

export class QzoneWriteApi {
    readonly #session: SessionState
    readonly #transport: FetchTransport

    constructor(session: SessionState, transport: FetchTransport) {
        this.#session = session
        this.#transport = transport
    }

    async uploadImage(
        image: PreparedPublishImage,
        signal?: AbortSignal
    ): Promise<UploadedPhoto> {
        const accountId = this.#requireAccountId()
        const skey =
            this.#session.getCookie('skey') ??
            this.#session.getCookie('p_skey') ??
            ''
        const privateSkey =
            this.#session.getCookie('p_skey') ??
            this.#session.getCookie('skey') ??
            ''
        const payload = await this.#transport.requestData(
            imageUploadEndpoint(accountId),
            {
                form: {
                    filename: image.name,
                    uin: accountId,
                    skey,
                    zzpaneluin: accountId,
                    p_uin: accountId,
                    p_skey: privateSkey,
                    qzonetoken: this.#session.getToken(accountId) ?? '',
                    uploadtype: 1,
                    albumtype: 7,
                    exttype: 0,
                    refer: 'shuoshuo',
                    output_type: 'json',
                    charset: 'utf-8',
                    output_charset: 'utf-8',
                    upload_hd: 1,
                    hd_width: 2048,
                    hd_height: 10000,
                    hd_quality: 96,
                    backUrls:
                        'http://upbak.photo.qzone.qq.com/cgi-bin/upload/cgi_upload_image,' +
                        'http://119.147.64.75/cgi-bin/upload/cgi_upload_image',
                    url: `https://up.qzone.qq.com/cgi-bin/upload/cgi_upload_image?g_tk=${this.#session.gtk}`,
                    base64: 1,
                    picfile: bytesToBase64(image.data),
                    qzreferrer: `https://user.qzone.qq.com/${accountId}`
                },
                signal
            }
        )
        return parseUploadedPhoto(payload, image)
    }

    async publishPost(
        content: string,
        photos: readonly UploadedPhoto[],
        signal?: AbortSignal
    ): Promise<PublishReceipt> {
        const accountId = this.#requireAccountId()
        try {
            const payload = await this.#transport.requestData(
                publishPostEndpoint(accountId),
                {
                    form: {
                        syn_tweet_verson: 1,
                        paramstr: 1,
                        who: 1,
                        con: content,
                        feedversion: 1,
                        ver: 1,
                        ugc_right: 1,
                        to_sign: 0,
                        hostuin: accountId,
                        code_version: 1,
                        richval: photos
                            .map((photo) => photo.richval)
                            .join('\t'),
                        issyncweibo: 0,
                        format: 'json',
                        qzreferrer: `https://user.qzone.qq.com/${accountId}`,
                        ...(photos.length > 0
                            ? {
                                  richtype: 1,
                                  subrichtype: 1,
                                  pic_bo: photos
                                      .map((photo) => photo.picBo)
                                      .filter(Boolean)
                                      .join(','),
                                  pic_template: ''
                              }
                            : {})
                    },
                    signal
                }
            )
            return parsePublishReceipt(payload)
        } catch (error) {
            if (
                error instanceof QzoneParseError ||
                (error instanceof QzoneRequestError &&
                    (error.context?.statusCode ?? 0) >= 500)
            ) {
                throw new UncertainTransportError('动态发布结果无法确认', {
                    cause: error,
                    context: { endpoint: 'post.publish' }
                })
            }
            throw error
        }
    }

    async comment(
        post: ProtocolPost,
        content: string,
        replyTo?: CommentReference,
        signal?: AbortSignal
    ): Promise<MutationReceipt> {
        const accountId = this.#requireAccountId()
        const referer = postReferer(post)
        return this.#requestMutation(
            commentEndpoint(post.authorId, post.id, Boolean(replyTo)),
            {
                topicId: `${post.authorId}_${post.id}__1`,
                uin: accountId,
                hostUin: post.authorId,
                feedsType: 100,
                inCharset: 'utf-8',
                outCharset: 'utf-8',
                plat: 'qzone',
                source: 'ic',
                platformid: 50,
                format: 'fs',
                ref: 'feeds',
                content,
                private: 0,
                paramstr: replyTo ? 2 : 1,
                isSignIn: 0,
                richval: '',
                richtype: '',
                appid: post.action.appId,
                busi_param: JSON.stringify(post.action.businessParameters),
                qzreferrer: referer,
                ...(replyTo
                    ? {
                          commentId: replyTo.id,
                          commentUin: replyTo.authorId
                      }
                    : {})
            },
            signal
        )
    }

    async setLike(
        post: ProtocolPost,
        liked: boolean,
        signal?: AbortSignal
    ): Promise<MutationReceipt> {
        const accountId = this.#requireAccountId()
        const form = {
            unikey: post.action.unlikeKey,
            curkey: post.action.currentLikeKey,
            appid: post.action.appId,
            opuin: accountId,
            uin: accountId,
            hostuin: post.authorId,
            fid: post.id,
            from: 1,
            typeid: 0,
            abstime: post.createdAt
                ? Math.floor(Date.parse(post.createdAt) / 1_000)
                : 0,
            active: 0,
            fupdate: 1,
            opr_type: liked ? 'like' : 'unlike',
            format: 'purejson',
            qzreferrer: postReferer(post)
        }
        const endpoints = likePostEndpoints(post.authorId, post.id, liked)
        try {
            return await this.#requestMutation(endpoints[0]!, form, signal)
        } catch (error) {
            if (!isDefinitelyUnavailable(error)) {
                throw error
            }
            return this.#requestMutation(endpoints[1]!, form, signal)
        }
    }

    async deletePost(
        post: ProtocolPost,
        createdAt: number,
        signal?: AbortSignal
    ): Promise<MutationReceipt> {
        const accountId = this.#requireAccountId()
        return this.#requestMutation(
            deletePostEndpoint(accountId, post.id),
            {
                uin: accountId,
                topicId: `${accountId}_${post.id}__1`,
                feedsType: 0,
                feedsFlag: 0,
                feedsKey: post.id,
                feedsAppid: post.action.appId,
                feedsTime: createdAt,
                fupdate: 1,
                ref: 'feeds',
                format: 'json',
                qzreferrer: `https://user.qzone.qq.com/${accountId}`
            },
            signal
        )
    }

    async #requestMutation(
        endpoint: TransportEndpoint,
        form: NonNullable<Parameters<FetchTransport['request']>[1]>['form'],
        signal?: AbortSignal
    ): Promise<MutationReceipt> {
        try {
            const response = await this.#transport.request(endpoint, {
                form,
                signal
            })
            if (response.status >= 300 && response.status < 400) {
                return Object.freeze({ id: null })
            }
            return parseMutationReceipt(
                parseResponseData(response.text, endpoint.id),
                endpoint.id
            )
        } catch (error) {
            if (
                error instanceof UncertainTransportError ||
                error instanceof QzoneParseError ||
                (error instanceof QzoneRequestError &&
                    isUncertainStatus(error.context?.statusCode ?? 0))
            ) {
                throw new UncertainTransportError('写操作结果无法确认', {
                    cause: error,
                    context: { endpoint: endpoint.id }
                })
            }
            throw error
        }
    }

    #requireAccountId(): string {
        const accountId = this.#session.accountId
        if (!accountId) {
            throw new QzoneValidationError('当前 Session 缺少账号')
        }
        return accountId
    }
}

function postReferer(post: ProtocolPost): string {
    return `https://user.qzone.qq.com/${post.authorId}/mood/${post.id}`
}

function isDefinitelyUnavailable(error: unknown): boolean {
    return (
        error instanceof QzoneRequestError &&
        [404, 405].includes(error.context?.statusCode ?? 0)
    )
}

function isUncertainStatus(status: number): boolean {
    return (status >= 300 && status < 400) || status >= 500
}

function bytesToBase64(data: Uint8Array): string {
    const chunks: string[] = []
    for (let offset = 0; offset < data.length; offset += 0x8000) {
        chunks.push(
            String.fromCharCode(...data.subarray(offset, offset + 0x8000))
        )
    }
    return btoa(chunks.join(''))
}
