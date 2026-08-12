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

export function computeGtk(cookies: ReadonlyMap<string, string>): number {
    for (const key of SECRET_KEYS) {
        const secret = cookies.get(key)
        if (secret) {
            return hash33(secret, GTK_SEED)
        }
    }

    const direct = cookies.get('g_tk')
    return direct && /^\d+$/u.test(direct) ? Number(direct) : 0
}
