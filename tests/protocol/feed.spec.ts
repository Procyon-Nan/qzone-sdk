import { describe, expect, it } from 'vitest'

import { parseFeedPage } from '../../src/protocol/feed.js'
import {
    mergeProtocolPost,
    parseProtocolPost
} from '../../src/protocol/post.js'
import { toPublicPost } from '../../src/protocol/types.js'

describe('protocol feed parsing', () => {
    it('normalizes a top-level legacy array and filters ignored items', () => {
        const page = parseFeedPage([
            { appid: 6600, key: 'advertisement_1', summary: '广告' },
            {
                appid: 311,
                key: 'post-1',
                opuin: '10002',
                nickname: '好友',
                html: [
                    '<li><div class="f-info">正常动态</div>',
                    '<a data-islike="1" data-likecnt="5"></a></li>'
                ].join('')
            }
        ])

        expect(page.items).toHaveLength(1)
        expect(page.items[0]).toMatchObject({
            id: 'post-1',
            authorId: '10002',
            authorNickname: '好友',
            content: '正常动态',
            likeCount: 5,
            liked: true,
            action: {
                currentLikeKey: 'http://user.qzone.qq.com/10002/mood/post-1',
                unlikeKey: 'http://user.qzone.qq.com/10002/mood/post-1'
            }
        })
    })

    it('normalizes modern page aliases and action metadata', () => {
        const page = parseFeedPage({
            data: {
                feedpage: {
                    vFeeds: [
                        {
                            id: { cellid: 'post-2' },
                            uin: '10002',
                            comm: {
                                appid: 311,
                                time: 1_690_000_000,
                                curkey: 'cur'
                            },
                            summary: { summary: '正文' },
                            like: { num: 2, isliked: 1 },
                            comment: { num: 3 },
                            operation: { busi_param: { source: 'feed' } }
                        }
                    ],
                    attachinfo: 'cursor-1',
                    hasMoreFeeds: 1
                }
            }
        })

        expect(page).toMatchObject({ cursor: 'cursor-1', hasMore: true })
        expect(page.items[0]).toMatchObject({
            id: 'post-2',
            authorId: '10002',
            content: '正文',
            createdAt: '2023-07-22T04:26:40.000Z',
            likeCount: 2,
            commentCount: 3,
            liked: true,
            action: {
                appId: 311,
                currentLikeKey: 'cur',
                businessParameters: { source: 'feed' }
            }
        })
    })

    it('reads legacy feed items beside main pagination metadata', () => {
        const page = parseFeedPage({
            data: {
                main: {
                    attach: 'cursor-2',
                    hasMoreFeeds: 1
                },
                data: [
                    {
                        key: 'post-3',
                        opuin: '10003',
                        nickname: '另一位好友',
                        html: '<li><div class="f-info">好友动态</div></li>'
                    }
                ]
            }
        })

        expect(page).toMatchObject({ cursor: 'cursor-2', hasMore: true })
        expect(page.items).toHaveLength(1)
        expect(page.items[0]).toMatchObject({
            id: 'post-3',
            authorId: '10003',
            authorNickname: '另一位好友',
            content: '好友动态'
        })
    })

    it('reads real msglist and shuoshuo detail field shapes', () => {
        expect(
            parseProtocolPost(
                {
                    id: { cellid: 'msglist-post' },
                    comm: {
                        appid: 311,
                        time: 1_690_000_000,
                        ugcrightkey: 'msglist-post'
                    },
                    summary: { summary: 'msglist text' }
                },
                '10001'
            )
        ).toMatchObject({
            id: 'msglist-post',
            content: 'msglist text',
            createdAt: '2023-07-22T04:26:40.000Z'
        })
        expect(
            parseProtocolPost(
                {
                    cell_id: { cellid: 'detail-post' },
                    cell_comm: {
                        appid: 311,
                        time: 1_690_000_001,
                        ugcrightkey: 'detail-post'
                    },
                    cell_summary: { summary: 'detail text' }
                },
                '10001'
            )
        ).toMatchObject({
            id: 'detail-post',
            content: 'detail text',
            createdAt: '2023-07-22T04:26:41.000Z'
        })
    })

    it('merges detail fields without losing list fallbacks', () => {
        const list = parseProtocolPost({
            fid: 'post-1',
            hostuin: '10001',
            nickname: '作者',
            summary: '列表正文',
            time: 1_690_000_000,
            pic: [{ url3: 'https://m.qpic.cn/list.jpg' }]
        })
        const merged = mergeProtocolPost(list, {
            fid: 'post-1',
            hostuin: '10001',
            summary: '详情正文',
            comments: [{ commentid: 'c1', uin: '10002', content: '评论' }]
        })

        expect(merged).toMatchObject({
            authorNickname: '作者',
            content: '详情正文',
            createdAt: '2023-07-22T04:26:40.000Z',
            media: [{ kind: 'image', url: 'https://m.qpic.cn/list.jpg' }],
            commentCount: 1
        })
    })

    it('preserves explicit zero and false detail state while merging action fields', () => {
        const list = parseProtocolPost({
            fid: 'post-1',
            hostuin: '10001',
            like: { num: 4, isliked: 1 },
            curkey: 'list-current',
            unikey: 'list-unlike',
            operation: { busi_param: { source: 'list' } }
        })
        const merged = mergeProtocolPost(list, {
            fid: 'post-1',
            hostuin: '10001',
            like: { num: 0, isliked: 0 },
            html: '<a data-islike="1" data-likecnt="5"></a>',
            curkey: 'detail-current'
        })

        expect(merged).toMatchObject({ likeCount: 0, liked: false })
        expect(merged.action).toMatchObject({
            currentLikeKey: 'detail-current',
            unlikeKey: 'list-unlike',
            businessParameters: { source: 'list' }
        })
    })

    it('maps protocol posts without leaking internal metadata', () => {
        const publicPost = toPublicPost(
            parseProtocolPost({
                fid: 'post-1',
                hostuin: '10001',
                nickname: '作者',
                summary: '正文',
                curkey: 'secret-action-key',
                operation: { busi_param: { private: true } }
            })
        )

        expect(publicPost).toMatchObject({
            id: 'post-1',
            authorId: '10001',
            author: { id: '10001', nickname: '作者' },
            content: '正文'
        })
        expect(publicPost).not.toHaveProperty('action')
        expect(JSON.stringify(publicPost)).not.toContain('secret-action-key')
        expect(JSON.stringify(publicPost)).not.toContain('private')
    })
})
