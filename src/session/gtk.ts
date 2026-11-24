import type { SessionInfo } from '../types.js'

const HASH_MASK = 0x7fffffff
const GTK_SEED = 5381

const SECRET_KEYS = ['p_skey', 'skey', 'skey2'] as const

export function hash33(value: string, initial = 0): number {
    let hash = initial
    for (const character of value) {
        hash = (hash * 33 + character.codePointAt(0)!) & HASH_MASK
    }
    return hash
}

/** 返回按 SDK 优先级选中的 g_tk 凭据来源。 */
export function gtkSourceOf(
    cookies: ReadonlyMap<string, string>
): SessionInfo['gtkSource'] {
    for (const key of SECRET_KEYS) {
        if (cookies.get(key)) {
            return key
        }
    }

    const direct = cookies.get('g_tk')
    return direct && /^\d+$/u.test(direct) ? 'g_tk' : 'none'
}

export function computeGtk(cookies: ReadonlyMap<string, string>): number {
    const source = gtkSourceOf(cookies)
    if (source === 'none') {
        return 0
    }
    if (source === 'g_tk') {
        return Number(cookies.get(source))
    }
    return hash33(cookies.get(source)!, GTK_SEED)
}
