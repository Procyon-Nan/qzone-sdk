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
                    },
                    {
                        fid: 'post-1',
                        userinfo: { user: { uin: 10002 } },
                        pic: [{ url3: 'https://m.qpic.cn/other-author.jpg' }]
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

    it('returns one image per mobile photo in post order', () => {
        const photos = ['b', 'a'].map((id) => ({
            url3: `https://m.qpic.cn/${id}-fallback.jpg`,
            photourl: {
                0: { url: `https://m.qpic.cn/${id}-small.jpg` },
                1: { url: `https://m.qpic.cn/${id}.jpg` },
                11: { url: `https://m.qpic.cn/${id}-preview.jpg` }
            }
        }))
        const expected = [
            { kind: 'image', url: 'https://m.qpic.cn/b.jpg' },
            { kind: 'image', url: 'https://m.qpic.cn/a.jpg' }
        ]

        expect(parseMedia({ pic: { picdata: photos } }, TARGET)).toEqual(
            expected
        )
        expect(parseMedia({ media: [photos[0]] }, TARGET)).toEqual([
            expected[0]
        ])
        const download_url = 'https://m.qpic.cn/document.pdf'
        const attachment = { photourl: photos[0]?.photourl, download_url }
        expect(parseMedia({ attachments: [attachment] }, TARGET)).toEqual([
            { kind: 'file', name: 'document.pdf', url: download_url }
        ])
        const photourl = [{ url: 'https://m.qpic.cn/small.jpg' }, expected[0]]
        expect(parseMedia({ pic: [{ photourl }] }, TARGET)).toEqual([
            expected[0]
        ])
    })

    it('uses an unknown photo variant only when the photo has no usable source', () => {
        const photourl = {
            42: { url: '' },
            43: { url: 'https://m.qpic.cn/first.jpg' },
            44: 'https://m.qpic.cn/second.jpg'
        }
        expect(parseMedia({ pic: [{ photourl }] }, TARGET)).toEqual([
            { kind: 'image', url: photourl[43].url }
        ])
        expect(
            parseMedia(
                { pic: [{ photourl, url3: 'https://qlogo.cn/avatar' }] },
                TARGET
            )
        ).toEqual([{ kind: 'image', url: photourl[43].url }])
        const url3 = 'https://m.qpic.cn/original.jpg'
        expect(parseMedia({ pic: [{ photourl, url3 }] }, TARGET)).toEqual([
            { kind: 'image', url: url3 }
        ])
    })

    it('keeps each mobile video with its own cover and ignores renditions', () => {
        const url = 'https://photovideo.photo.qq.com/clip.mp4'
        const cover = 'https://m.qpic.cn/cover'
        const clip = {
            videourl: url,
            coverurl: { 0: { url: cover }, 1: { url: cover + '/small' } },
            videourls: { 0: { url }, 5: { url: url + '?quality=low' } }
        }
        const other = {
            ...clip,
            videourl: url + '?clip=2',
            coverurl: [{ url: cover + '/2' }]
        }
        const media = parseMedia(
            {
                video: [clip, other, { coverurl: clip.coverurl }],
                pic: [{ url: cover + '/photo' }],
                attachments: [
                    {
                        type: 'file',
                        name: 'notes.pdf',
                        download_url: 'https://example.com/notes.pdf'
                    }
                ]
            },
            TARGET
        )
        expect(media.map((m) => m.kind)).toEqual([
            'image',
            'file',
            'video',
            'video'
        ])
        expect(media.slice(2)).toMatchObject([
            { url, previewUrl: cover },
            { url: other.videourl, previewUrl: cover + '/2' }
        ])
    })

    it('retains the direct rendition when the same video first appears as a player', () => {
        const cover = 'https://example.test/first.jpg'
        const url = 'https://example.test/first.mp4'
        const media = parseMedia(
            {
                pic: [
                    {
                        video_info: {
                            vid: 'v1',
                            url1: cover,
                            url3: 'https://cache.tv.qq.com/player.swf?v=v1'
                        }
                    }
                ],
                video: [
                    { video_id: 'v2', url3: 'https://example.test/second.mp4' },
                    { video_id: 'v1', url3: url }
                ]
            },
            TARGET
        )
        expect(media).toMatchObject([
            { kind: 'video', id: 'v1', url, previewUrl: cover },
            { kind: 'video', id: 'v2' }
        ])
    })

    it.each([
        'https://cache.tv.qq.com/qqplayerout.swf?v=first&auto=0',
        'https://user.qzone.qq.com/10001/qzvideo/first'
    ])(
        'omits a video whose player identifies a different upload: %s',
        (url3) => {
            expect(
                parseMedia(
                    {
                        pic: [
                            {
                                is_video: 1,
                                video_info: {
                                    vid: 'second',
                                    video_id: 'second',
                                    url3,
                                    url1: 'https://m.qpic.cn/second.jpg'
                                }
                            }
                        ]
                    },
                    TARGET
                )
            ).toEqual([])
        }
    )

    it('reads each detail video from url3 and its cover from url1', () => {
        const clip = {
            video_id: 'clip',
            url1: 'https://m.qpic.cn/cover',
            pic_url: '',
            url3: 'https://photovideo.photo.qq.com/a.mp4'
        }
        const media = parseMedia(
            { video: [{ ...clip, url3: '' }, clip] },
            TARGET
        )
        expect(media).toHaveLength(1)
        expect(media[0]).toMatchObject({
            kind: 'video',
            url: clip.url3,
            previewUrl: clip.url1
        })
    })

    it('keeps playback, cover and file addresses distinct', () => {
        const playlist = 'https://example.com/clip.m3u8'
        const cover = 'https://example.com/cover.jpg'
        const file = 'https://example.com/notes.pdf'
        const media = parseMedia(
            {
                video: [
                    { videoid: 'clip', videourl: playlist },
                    {
                        videoid: 'no-playback',
                        videourl: '',
                        coverurl: [{ url: cover }],
                        url: cover
                    }
                ],
                attachments: [{ videoid: 'clip', download_url: file }]
            },
            TARGET
        )
        expect(media).toEqual([
            { kind: 'file', url: file, name: 'notes.pdf' },
            { kind: 'video', id: 'clip', url: playlist },
            { kind: 'video', id: 'no-playback', url: '', previewUrl: cover }
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
                id: 'clip',
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
