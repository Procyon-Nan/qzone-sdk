import { describe, expectTypeOf, it } from 'vitest'

import type {
    ListFeedsOptions,
    MutationOutcome,
    PublishPostOptions,
    QzoneErrorOptions,
    QzoneMedia,
    QzonePost,
    QzoneSession,
    QzoneTimestamp
} from '../src/index.js'

describe('public type contracts', () => {
    it('uses discriminated feed scopes', () => {
        const profile: ListFeedsOptions = {
            scope: 'profile',
            userId: '10001'
        }

        if (profile.scope === 'profile') {
            expectTypeOf(profile.userId).toEqualTypeOf<string>()
        }

        // @ts-expect-error userId is only valid for profile feeds
        const selfWithUserId: ListFeedsOptions = {
            scope: 'self',
            userId: '10001'
        }

        expectTypeOf(selfWithUserId).toEqualTypeOf<ListFeedsOptions>()
    })

    it('uses serializable identifiers and timestamps', () => {
        expectTypeOf<QzonePost['id']>().toEqualTypeOf<string>()
        expectTypeOf<QzonePost['authorId']>().toEqualTypeOf<string>()
        expectTypeOf<QzoneTimestamp>().toEqualTypeOf<string>()
        expectTypeOf<QzonePost['createdAt']>().toEqualTypeOf<string | null>()
    })

    it('limits mutation outcomes to the approved states', () => {
        expectTypeOf<MutationOutcome>().toEqualTypeOf<
            'verified' | 'accepted' | 'unknown' | 'already-applied'
        >()
    })

    it('models read media separately from publish images', () => {
        expectTypeOf<QzoneMedia['kind']>().toEqualTypeOf<
            'image' | 'video' | 'audio' | 'file'
        >()
        expectTypeOf<
            NonNullable<PublishPostOptions['images']>[number]['data']
        >().toEqualTypeOf<Uint8Array | ArrayBuffer | Blob>()
    })

    it('marks exported session collections as readonly', () => {
        expectTypeOf<QzoneSession['cookies']>().toEqualTypeOf<
            Readonly<Record<string, string>>
        >()
        expectTypeOf<QzoneSession['tokens']>().toEqualTypeOf<
            Readonly<Record<string, string>>
        >()
    })

    it('exports options referenced by public error constructors', () => {
        expectTypeOf<QzoneErrorOptions>().toMatchTypeOf<ErrorOptions>()
    })
})
