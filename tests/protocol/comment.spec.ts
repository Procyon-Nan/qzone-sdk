import { describe, expect, it } from 'vitest'

import { parseComments } from '../../src/protocol/comment.js'

describe('protocol comment parsing', () => {
    it('flattens nested replies and removes duplicate comments', () => {
        const comment = {
            commentid: 'c1',
            uin: '10002',
            nickname: '好友',
            content: '一级评论',
            pubtime: 1_690_000_000,
            replyList: [
                {
                    commentId: 'r1',
                    commentUin: '10003',
                    name: '回复者',
                    htmlContent: '<b>回复</b>',
                    replies: [
                        {
                            id: 'r2',
                            uin: '10004',
                            content: '嵌套回复'
                        }
                    ]
                }
            ]
        }
        const comments = parseComments({
            comment: { comments: [comment] },
            commentlist: [comment]
        })

        expect(comments).toHaveLength(3)
        expect(comments[0]).toMatchObject({
            id: 'c1',
            author: { id: '10002', nickname: '好友' },
            content: '一级评论',
            parentId: null
        })
        expect(comments[1]).toMatchObject({ id: 'r1', parentId: 'c1' })
        expect(comments[2]).toMatchObject({ id: 'r2', parentId: 'r1' })
    })

    it('accepts single-record and keyed-map comment containers', () => {
        const comments = parseComments({
            comments: {
                commentid: 'single',
                user: { uin: '10002', nickname: '单条作者' },
                content: '单条评论'
            },
            commentlist: {
                first: {
                    commentid: 'mapped',
                    uin: '10003',
                    content: '映射评论'
                }
            }
        })

        expect(comments).toEqual([
            {
                id: 'single',
                author: { id: '10002', nickname: '单条作者' },
                content: '单条评论',
                createdAt: null,
                parentId: null
            },
            {
                id: 'mapped',
                author: { id: '10003', nickname: '' },
                content: '映射评论',
                createdAt: null,
                parentId: null
            }
        ])
    })
})
