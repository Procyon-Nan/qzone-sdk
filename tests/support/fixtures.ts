export function jsonResponse(data: unknown, init: ResponseInit = {}): Response {
    const headers = new Headers(init.headers)
    if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json; charset=utf-8')
    }

    return new Response(JSON.stringify(data), { ...init, headers })
}

export function textResponse(text: string, init: ResponseInit = {}): Response {
    return new Response(text, init)
}

// 来自同一条 appid=202 分享的列表和详情结构，账号、ID、URL 已替换。
export const shareCard = {
    title: 'Just The Two Of Us',
    summary: '38万播放 · 10.6万点赞 · 74弹幕',
    url: 'https://example.test/share?id=1&source=qzone',
    previewUrl: 'https://m.qpic.cn/share-cover.jpg'
}

function sharePhoto() {
    return {
        photourl: {
            0: { url: 'https://m.qpic.cn/share-original.jpg' },
            1: { url: shareCard.previewUrl },
            11: { url: 'https://m.qpic.cn/share-small.jpg' }
        }
    }
}

export function shareListPost(id = 'share-1') {
    return {
        comm: { appid: 202, time: 1_790_000_000 },
        id: { cellid: id },
        userinfo: { user: { uin: 10002, nickname: '分享者' } },
        cell_left_thumb: {
            title: shareCard.title,
            summary: shareCard.summary,
            actionturl: shareCard.url,
            picdata: sharePhoto()
        }
    }
}

export function shareDetailPost(id = 'share-1') {
    return {
        cell_comm: { appid: 202, time: 1_790_000_000 },
        cell_id: { cellid: id },
        cell_userinfo: { uin: 10002, nickname: '分享者' },
        cell_original: {
            cell_title: { title: shareCard.title },
            cell_summary: {
                summary:
                    shareCard.summary +
                    '[em]e10007[/em]{url:' +
                    encodeURIComponent(shareCard.url) +
                    ',text:网页链接}'
            },
            cell_pic: { picdata: [sharePhoto()] }
        }
    }
}
