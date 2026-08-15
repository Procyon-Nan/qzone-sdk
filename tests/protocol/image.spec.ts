import { describe, expect, it } from 'vitest'

import { QzoneValidationError } from '../../src/errors.js'
import { preparePublishImage } from '../../src/protocol/image.js'

describe('publish image validation', () => {
    it.each([
        ['JPEG', jpeg(16, 17), 1],
        ['PNG', png(18, 19), 3],
        ['GIF', gif(20, 21), 2],
        ['BMP', bmp(22, 23), 4],
        ['WebP', webp(24, 25), 1]
    ])('reads %s signatures and dimensions', async (_name, data, qqType) => {
        const image = await preparePublishImage({ data, name: 'image.bin' })

        expect(image).toMatchObject({
            width: dimensions(data).width,
            height: dimensions(data).height,
            qqType
        })
    })

    it('accepts Blob input and copies mutable byte input immediately', async () => {
        const bytes = png(16, 16)
        const copyPromise = preparePublishImage({ data: bytes, name: 'a.png' })
        bytes[23] = 99

        const copied = await copyPromise
        const blobBytes = png(17, 18)
        const blob = await preparePublishImage({
            data: new Blob([new Uint8Array(blobBytes).buffer], {
                type: 'image/png'
            }),
            name: 'b.png'
        })
        const bufferBytes = png(19, 20)
        const buffer = await preparePublishImage({
            data: new Uint8Array(bufferBytes).buffer,
            name: 'c.png'
        })

        expect(copied.height).toBe(16)
        expect(copied.data[23]).toBe(16)
        expect(blob).toMatchObject({ width: 17, height: 18 })
        expect(buffer).toMatchObject({ width: 19, height: 20 })
    })

    it('rejects empty, unsupported, malformed, and undersized images', async () => {
        await expect(
            preparePublishImage({ data: new Uint8Array(), name: 'empty.png' })
        ).rejects.toBeInstanceOf(QzoneValidationError)
        await expect(
            preparePublishImage({
                data: new TextEncoder().encode('not an image'),
                name: 'fake.png'
            })
        ).rejects.toBeInstanceOf(QzoneValidationError)
        await expect(
            preparePublishImage({
                data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
                name: 'broken.png'
            })
        ).rejects.toBeInstanceOf(QzoneValidationError)
        await expect(
            preparePublishImage({ data: png(15, 100), name: 'small.png' })
        ).rejects.toBeInstanceOf(QzoneValidationError)
    })
})

function dimensions(data: Uint8Array): { width: number; height: number } {
    if (data[0] === 0xff) {
        return {
            width: (data[9]! << 8) | data[10]!,
            height: (data[7]! << 8) | data[8]!
        }
    }
    if (String.fromCharCode(...data.subarray(0, 3)) === 'GIF') {
        return {
            width: data[6]! | (data[7]! << 8),
            height: data[8]! | (data[9]! << 8)
        }
    }
    if (String.fromCharCode(...data.subarray(0, 2)) === 'BM') {
        const view = new DataView(data.buffer)
        return {
            width: view.getInt32(18, true),
            height: view.getInt32(22, true)
        }
    }
    if (String.fromCharCode(...data.subarray(0, 4)) === 'RIFF') {
        return {
            width: 1 + data[24]! + (data[25]! << 8) + (data[26]! << 16),
            height: 1 + data[27]! + (data[28]! << 8) + (data[29]! << 16)
        }
    }
    const view = new DataView(data.buffer)
    return { width: view.getUint32(16), height: view.getUint32(20) }
}

function png(width: number, height: number): Uint8Array {
    const data = new Uint8Array(24)
    data.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    data.set(new TextEncoder().encode('IHDR'), 12)
    const view = new DataView(data.buffer)
    view.setUint32(16, width)
    view.setUint32(20, height)
    return data
}

function jpeg(width: number, height: number): Uint8Array {
    return new Uint8Array([
        0xff,
        0xd8,
        0xff,
        0xc0,
        0,
        7,
        8,
        height >> 8,
        height & 0xff,
        width >> 8,
        width & 0xff
    ])
}

function gif(width: number, height: number): Uint8Array {
    return new Uint8Array([
        ...new TextEncoder().encode('GIF89a'),
        width & 0xff,
        width >> 8,
        height & 0xff,
        height >> 8
    ])
}

function bmp(width: number, height: number): Uint8Array {
    const data = new Uint8Array(26)
    data.set(new TextEncoder().encode('BM'))
    const view = new DataView(data.buffer)
    view.setInt32(18, width, true)
    view.setInt32(22, height, true)
    return data
}

function webp(width: number, height: number): Uint8Array {
    const data = new Uint8Array(30)
    data.set(new TextEncoder().encode('RIFF'))
    data.set(new TextEncoder().encode('WEBP'), 8)
    data.set(new TextEncoder().encode('VP8X'), 12)
    writeUint24(data, 24, width - 1)
    writeUint24(data, 27, height - 1)
    return data
}

function writeUint24(data: Uint8Array, offset: number, value: number): void {
    data[offset] = value & 0xff
    data[offset + 1] = (value >> 8) & 0xff
    data[offset + 2] = (value >> 16) & 0xff
}
