const HTTP_HOSTS = new Set(['user.qzone.qq.com', 'h5.qzone.qq.com'])

export function isQqHttpUrl(url: URL): boolean {
    return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        (url.hostname === 'qq.com' || url.hostname.endsWith('.qq.com'))
    )
}

export function isAllowedHttpHost(hostname: string): boolean {
    return HTTP_HOSTS.has(hostname.toLowerCase())
}
