import {
    QzoneParseError,
    QzoneRequestError,
    QzoneValidationError
} from '../errors.js'
import {
    imageUploadEndpoint,
    publishPostEndpoint
} from '../protocol/endpoints.js'
import type { PreparedPublishImage } from '../protocol/image.js'
import {
    parsePublishReceipt,
    parseUploadedPhoto,
    type PublishReceipt,
    type UploadedPhoto
} from '../protocol/publish.js'
import type { SessionState } from '../session/session.js'
import {
    FetchTransport,
    UncertainTransportError
} from '../transport/fetch-transport.js'

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

    #requireAccountId(): string {
        const accountId = this.#session.accountId
        if (!accountId) {
            throw new QzoneValidationError('当前 Session 缺少账号')
        }
        return accountId
    }
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
