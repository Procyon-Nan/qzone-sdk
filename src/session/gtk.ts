const HASH_MASK = 0x7fffffff
const GTK_SEED = 5381

const SECRET_KEYS = ['p_skey', 'skey', 'skey2'] as const

/** g_tk 的派生来源。说说类接口（emotion_cgi_*）只接受 p_skey 派生值。 */
export type GtkSource = 'p_skey' | 'skey' | 'skey2' | 'g_tk' | 'none'

export function hash33(value: string, initial = 0): number {
    let hash = initial
    for (const character of value) {
        hash = (hash * 33 + character.codePointAt(0)!) & HASH_MASK
    }
    return hash
}

/**
 * 返回将用于计算 g_tk 的凭据来源。
 *
 * `p_skey` 之外来源派生的 g_tk 在部分接口（如说说列表 `emotion_cgi_msglist_v6`）
 * 上会被服务端以业务码 -3000（"请先登录空间"）拒绝。
 */
export function gtkSourceOf(cookies: ReadonlyMap<string, string>): GtkSource {
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
        const direct = cookies.get('g_tk')!
        return /^\d+$/u.test(direct) ? Number(direct) : 0
    }
    return hash33(cookies.get(source)!, GTK_SEED)
}
