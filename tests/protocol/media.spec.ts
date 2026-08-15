import { describe, expect, it } from 'vitest'

import { parseMedia } from '../../src/protocol/media.js'

const TARGET = { postId: 'post-1', authorId: '10001' }

describe('protocol media parsing', () => {
    it('selects and deduplicates Qzone photo variants', () => {
        const listVariant =
            'http://photo.store.qq.com/psc?/V50/token/photo-a/m&bo=old&w=120&h=160'
        const detailVariant =
            'https://m.qpic.cn/psc?/V50/token/photo-a/b&bo=new'
        const media = parseMedia(
            {
                fid: 'post-1',
                hostuin: '10001',
                pic: [
                    {
                        pic_id: listVariant,
                        url3: detailVariant,
                        url1: listVariant
                    }
                ],
                html: `<img src="${listVariant}">`
            },
            TARGET
        )

        expect(media).toEqual([{ kind: 'image', url: detailVariant }])
    })

    it('filters avatar and emoticon images', () => {
        expect(
            parseMedia(
                {
                    html: [
                        '<img src="http://qlogo1.store.qq.com/qzone/1/1/50">',
                        '<img src="https://qzonestyle.gtimg.cn/qzone/em/e178.gif">'
                    ].join('')
                },
                TARGET
            )
        ).toEqual([])
    })

    it('keeps media scoped to the target post and author', () => {
        const media = parseMedia(
            {
                feed: [
                    {
                        fid: 'post-1',
                        hostuin: '10001',
                        pic: [{ url3: 'https://m.qpic.cn/current.jpg' }]
                    },
                    {
                        fid: 'post-2',
                        hostuin: '10002',
                        pic: [{ url3: 'https://m.qpic.cn/neighbor.jpg' }]
                    }
                ]
            },
            TARGET
        )

        expect(media).toEqual([
            { kind: 'image', url: 'https://m.qpic.cn/current.jpg' }
        ])
    })

    it('normalizes composite post keys and nested media authors', () => {
        const media = parseMedia(
            {
                feed: [
                    {
                        comm: { ugcrightkey: '10001_311_post-1_' },
                        userinfo: { uin: '10001' },
                        pic: [{ url3: 'https://m.qpic.cn/composite.jpg' }]
                    },
                    {
                        comm: { ugcrightkey: '10002_311_post-2_' },
                        userinfo: { uin: '10002' },
                        pic: [{ url3: 'https://m.qpic.cn/neighbor.jpg' }]
                    },
                    {
                        userinfo: { uin: '10002' },
                        pic: [{ url3: 'https://m.qpic.cn/wrong-author.jpg' }]
                    }
                ]
            },
            TARGET
        )

        expect(media).toEqual([
            { kind: 'image', url: 'https://m.qpic.cn/composite.jpg' }
        ])
    })

    it('reads nested and numeric-map image containers', () => {
        const media = parseMedia(
            {
                cell_pic: {
                    picdata: {
                        0: {
                            albumid: 'album-a',
                            lloc: 'photo-a',
                            photourl: {
                                1: {
                                    url: 'https://m.qpic.cn/nested-original.jpg'
                                }
                            }
                        }
                    }
                }
            },
            TARGET
        )

        expect(media).toEqual([
            {
                kind: 'image',
                url: 'https://m.qpic.cn/nested-original.jpg'
            }
        ])
    })

    it('normalizes video, audio and file attachments', () => {
        const media = parseMedia(
            {
                fid: 'post-1',
                pic: [
                    {
                        is_video: 1,
                        url3: 'https://photo.store.qq.com/cover.jpg',
                        video_info: {
                            url3: 'https://photovideo.photo.qq.com/clip.mp4',
                            video_id: 'clip',
                            video_time: 14000
                        }
                    }
                ],
                attachments: [
                    {
                        type: 'audio',
                        name: 'voice.mp3',
                        play_url: 'https://qzone.example.test/voice.mp3'
                    },
                    {
                        type: 'file',
                        file_name: 'document.pdf',
                        download_url: 'https://qzone.example.test/document.pdf',
                        file_size: 2048
                    }
                ]
            },
            TARGET
        )

        expect(media).toEqual([
            {
                kind: 'video',
                url: 'https://photovideo.photo.qq.com/clip.mp4',
                name: 'clip.mp4',
                mimeType: 'video/mp4',
                previewUrl: 'https://photo.store.qq.com/cover.jpg',
                durationMs: 14000
            },
            {
                kind: 'audio',
                url: 'https://qzone.example.test/voice.mp3',
                name: 'voice.mp3'
            },
            {
                kind: 'file',
                url: 'https://qzone.example.test/document.pdf',
                name: 'document.pdf',
                size: 2048
            }
        ])
    })

    it('does not classify MIME or flag identified videos as images', () => {
        const media = parseMedia(
            {
                media: [
                    {
                        mime_type: 'video/mp4',
                        url: 'https://qzone.example.test/mime-video'
                    },
                    {
                        is_video: 1,
                        url: 'https://qzone.example.test/flag-video'
                    }
                ]
            },
            TARGET
        )

        expect(media).toEqual([
            {
                kind: 'video',
                url: 'https://qzone.example.test/mime-video',
                name: 'mime-video',
                mimeType: 'video/mp4'
            },
            {
                kind: 'video',
                url: 'https://qzone.example.test/flag-video',
                name: 'flag-video'
            }
        ])
    })
})
