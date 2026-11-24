import type { QzoneShareCard } from '../types.js'
import { htmlToText } from './html.js'
import { imageSource } from './media.js'
import { normalizeRemoteUrl } from './media-url.js'
import { asRecord, asRecords, type ProtocolRecord } from './value.js'

/** 保留字段缺席状态，供详情合并时沿用列表中已有的卡片信息。 */
export function parseShareCard(
    raw: ProtocolRecord
): Partial<QzoneShareCard> | undefined {
    const card = asRecord(raw.cell_left_thumb)
    const original = asRecord(raw.cell_original)
    const title = text(card?.title ?? asRecord(original?.cell_title)?.title)
    const description =
        card?.summary ?? asRecord(original?.cell_summary)?.summary
    let embeddedUrl = ''
    const summary =
        typeof description === 'string'
            ? htmlToText(
                  description.replace(
                      /(?:\[em\]e10007\[\/em\])?\{url:([^{}]*?),text:[^{}]*\}/gu,
                      (_match, encoded: string) => {
                          let decoded: string
                          try {
                              decoded = decodeURIComponent(encoded)
                          } catch {
                              return ''
                          }
                          embeddedUrl ||= normalizeRemoteUrl(decoded)
                          return ''
                      }
                  )
              )
            : undefined
    const url = normalizeRemoteUrl(card?.actionturl) || embeddedUrl
    const photos = card?.picdata ?? asRecord(original?.cell_pic)?.picdata
    const previewUrl = asRecords(photos).map(imageSource).find(Boolean)
    const share = {
        ...(title !== undefined ? { title } : {}),
        ...(summary !== undefined ? { summary } : {}),
        ...(url ? { url } : {}),
        ...(previewUrl ? { previewUrl } : {})
    }
    return Object.keys(share).length ? Object.freeze(share) : undefined
}

function text(value: unknown): string | undefined {
    return typeof value === 'string' ? htmlToText(value) : undefined
}
