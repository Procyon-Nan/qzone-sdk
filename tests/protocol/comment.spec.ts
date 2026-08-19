import { describe, expect, it } from 'vitest'

import {
    parseComments,
    parseCommentSnapshot
} from '../../src/protocol/comment.js'

describe('protocol comment parsing', () => {
    it('flattens nested replies without inventing actual reply targets', () => {
        const comment = {
            commentid: 'c1',
            uin: '10002',
            nickname: 'friend',
            content: 'root',
            pubtime: 1_690_000_000,
            replynum: 2,
            replyList: [
                {
                    commentId: 'r1',
                    commentUin: '10003',
                    name: 'replier',
                    htmlContent: '<b>reply</b>',
                    replies: [
                        {
                            id: 'r2',
                            uin: '10004',
                            content: 'nested reply'
                        }
                    ]
                }
            ]
        }
        const comments = parseComments({
            cmtnum: 1,
            comment: { comments: [comment] },
            commentlist: [comment]
        })

        expect(comments).toHaveLength(3)
        expect(comments[0]).toMatchObject({
            id: 'c1',
            author: { id: '10002', nickname: 'friend' },
            content: 'root',
            parentId: null,
            threadRoot: null,
            replyTo: null,
            kind: 'comment'
        })
        expect(comments[1]).toMatchObject({
            id: 'r1',
            parentId: 'c1',
            threadRoot: { id: 'c1', authorId: '10002' },
            replyTo: null,
            kind: 'reply'
        })
        expect(comments[2]).toMatchObject({
            id: 'r2',
            parentId: 'r1',
            threadRoot: { id: 'c1', authorId: '10002' },
            replyTo: null,
            kind: 'reply'
        })
    })

    it('accepts single-record and keyed-map comment containers', () => {
        const comments = parseComments({
            comments: {
                commentid: 'single',
                user: { uin: '10002', nickname: 'single author' },
                content: 'single comment'
            },
            commentlist: {
                first: {
                    commentid: 'mapped',
                    uin: '10003',
                    content: 'mapped comment'
                }
            }
        })

        expect(comments).toEqual([
            {
                id: 'single',
                author: { id: '10002', nickname: 'single author' },
                content: 'single comment',
                createdAt: null,
                parentId: null,
                threadRoot: null,
                replyTo: null,
                kind: 'comment'
            },
            {
                id: 'mapped',
                author: { id: '10003', nickname: '' },
                content: 'mapped comment',
                createdAt: null,
                parentId: null,
                threadRoot: null,
                replyTo: null,
                kind: 'comment'
            }
        ])
    })

    it('treats a payload-level list_3 as first-level comments', () => {
        const comments = parseComments({
            list_3: [{ tid: 'root', uin: '10002', content: 'root comment' }]
        })

        expect(comments).toMatchObject([
            {
                id: 'root',
                kind: 'comment',
                parentId: null,
                threadRoot: null,
                replyTo: null
            }
        ])
    })

    it('keeps cross-layer ID collisions and skips malformed nodes', () => {
        const comments = parseComments({
            commentlist: [
                {
                    tid: 'shared',
                    uin: '10002',
                    content: 'root',
                    replynum: 2,
                    list_3: [
                        { tid: 'shared', uin: '10002', content: 'reply' },
                        { tid: '', uin: '', content: 'malformed' }
                    ]
                }
            ]
        })

        expect(comments.map(({ id, author }) => [id, author.id])).toEqual([
            ['shared', '10002'],
            ['shared', '10002']
        ])
        expect(comments.map((comment) => comment.kind)).toEqual([
            'comment',
            'reply'
        ])
    })

    it('marks a single detail snapshot complete only when all counts match', () => {
        const complete = parseCommentSnapshot({
            cmtnum: 1,
            total: 1,
            commentlist: [
                {
                    tid: 'c1',
                    uin: '10002',
                    content: 'root',
                    reply_num: 1,
                    list_3: [{ tid: 'r1', uin: '10003', content: 'reply' }]
                }
            ]
        })
        const truncated = parseCommentSnapshot({
            cmtnum: 1,
            commentlist: [
                {
                    tid: 'c1',
                    uin: '10002',
                    content: 'root',
                    replyNum: 2,
                    list_3: [{ tid: 'r1', uin: '10003', content: 'reply' }]
                }
            ]
        })

        expect(complete).toMatchObject({
            rootCount: 1,
            reportedCount: 1,
            complete: true,
            present: true
        })
        expect(truncated.complete).toBe(false)
    })

    it('recognizes an explicitly empty snapshot and rejects missing evidence', () => {
        expect(
            parseCommentSnapshot({ cmtnum: 0, commentlist: [] })
        ).toMatchObject({
            items: [],
            rootCount: 0,
            reportedCount: 0,
            complete: true,
            present: true
        })
        expect(parseCommentSnapshot({ commentlist: [] }).complete).toBe(false)
    })
})
