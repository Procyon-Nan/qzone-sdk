import { createHash } from 'node:crypto'
import {
    QzoneAuthError,
    QzoneParseError,
    QzoneValidationError
} from '../errors.js'
import { videoUploadEndpoint } from '../protocol/endpoints.js'
import { publishBytes } from '../protocol/image.js'
import { assertPayloadSuccess } from '../protocol/payload.js'
import { asRecord, toText } from '../protocol/value.js'
import { hash33 } from '../session/gtk.js'
import type { SessionState } from '../session/session.js'
import type { FetchTransport } from '../transport/fetch-transport.js'
import type { PublishVideoInput } from '../types.js'

export interface PreparedVideo {
    readonly data: Buffer
    readonly name: string
}

export async function prepareVideo(
    input: PublishVideoInput
): Promise<PreparedVideo> {
    if (!input || typeof input.name !== 'string' || !input.name.trim())
        throw new QzoneValidationError('发布视频缺少文件名')
    const data = await publishBytes(input.data)
    const box = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
    if (
        box.length < 16 ||
        box.toString('ascii', 4, 8) !== 'ftyp' ||
        box.readUInt32BE(0) < 16 ||
        box.readUInt32BE(0) > box.length ||
        !/^(isom|iso[2-9]|mp4[12]|avc1|M4V )$/.test(
            box.toString('ascii', 8, 12)
        )
    )
        throw new QzoneValidationError('发布视频必须是 MP4')
    return { data: box, name: input.name }
}

export async function uploadVideo(
    transport: FetchTransport,
    session: SessionState,
    video: PreparedVideo,
    signal?: AbortSignal
) {
    const uin = session.accountId
    const ticket = session.getCookie('p_skey')
    if (!uin || !ticket)
        throw new QzoneAuthError('视频上传需要空间账号和 p_skey')
    const gtk = hash33(session.getCookie('skey') || ticket, 5381)
    const checksum = createHash('sha1').update(video.data).digest('hex')
    const control = videoUploadEndpoint(checksum)
    const appid = 'video_qzone'
    const cmd = 'FileUploadVideo'
    const total = video.data.length
    const response = await transport.requestData(control, {
        query: { g_tk: gtk },
        signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            control_req: [
                {
                    uin,
                    token: { type: 4, data: ticket, appid: 5 },
                    appid,
                    cmd,
                    checksum,
                    check_type: 1,
                    file_len: total,
                    env: { refer: 'qzone', deviceInfo: 'h5' },
                    model: 0,
                    biz_req: {
                        sTitle: video.name,
                        sDesc: '',
                        iFlag: 0,
                        iUploadTime: Math.floor(Date.now() / 1000),
                        iPlayTime: 0,
                        iNeedFeeds: 0,
                        sCoverUrl: '',
                        iIsNew: 111,
                        iIsOriginalVideo: 0,
                        iIsFormatF20: 0,
                        extend_info: {
                            video_type: '3',
                            qz_video_format: 'mp4',
                            ugc_right: '1',
                            who: '1'
                        }
                    },
                    session: '',
                    asy_upload: 0
                }
            ]
        })
    })
    assertPayloadSuccess(response, control.id)
    const options = asRecord(asRecord(response)?.data)
    const handle = toText(options?.session)
    const size = Number(options?.slice_size)
    if (!handle || !Number.isSafeInteger(size) || size <= 0)
        throw new QzoneParseError('视频上传控制响应缺少会话或分片大小')
    const endpoint = videoUploadEndpoint()
    for (let offset = 0, seq = 1; offset < total; offset += size, seq++) {
        const end = Math.min(offset + size, total)
        const body = new FormData()
        body.set('uin', uin)
        body.set('appid', appid)
        body.set(
            'data',
            new Blob([new Uint8Array(video.data.subarray(offset, end))]),
            'blob'
        )
        for (const [key, value] of Object.entries({
            session: handle,
            offset,
            checksum: '',
            check_type: 0,
            retry: 0,
            seq,
            end,
            cmd,
            slice_size: size,
            'biz_req.iUploadType': 0
        }))
            body.set(key, String(value))
        const result = await transport.requestData(endpoint, {
            body,
            signal,
            query: {
                seq,
                retry: 0,
                offset,
                end,
                total,
                type: 'form',
                g_tk: gtk
            }
        })
        assertPayloadSuccess(result, endpoint.id)
        if (end === total) {
            const data = asRecord(asRecord(result)?.data)
            const vid = toText(asRecord(data?.biz)?.sVid ?? data?.sVid)
            if (vid) return vid
        }
    }
    throw new QzoneParseError('视频上传完成响应缺少 sVid')
}
