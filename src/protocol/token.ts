import { QzoneParseError } from '../errors.js'
import { extractScripts } from './html.js'

const TOKEN_PATTERN =
    /window\.shine0callback[\s\S]*?return\s+["']([0-9a-f]+)["']/iu

export function extractQzoneToken(html: string): string {
    const script = extractScripts(html).find((value) =>
        value.includes('shine0callback')
    )
    const token = script ? TOKEN_PATTERN.exec(script)?.[1] : undefined
    if (!token) {
        throw new QzoneParseError('QQ 空间页面缺少 qzonetoken')
    }
    return token
}
