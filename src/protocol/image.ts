import { QzoneValidationError } from '../errors.js'
import type { PublishImageInput } from '../types.js'

const MIN_IMAGE_SIDE = 16

export interface PreparedPublishImage {
    readonly data: Uint8Array
    readonly name: string
    readonly width: number
    readonly height: number
    readonly qqType: number
}

export async function preparePublishImage(
    input: PublishImageInput
): Promise<PreparedPublishImage> {
    if (!input || typeof input !== 'object') {
        throw new QzoneValidationError('发布图片必须是对象')
    }
    const name = typeof input.name === 'string' ? input.name.trim() : ''
    if (!name) {
        throw new QzoneValidationError('发布图片文件名不能为空')
    }
    if (input.mimeType !== undefined && typeof input.mimeType !== 'string') {
        throw new QzoneValidationError('发布图片 MIME 类型必须是字符串')
    }

    const data = await copyImageData(input.data)
    if (data.length === 0) {
        throw new QzoneValidationError(`图片 ${name} 的内容不能为空`)
    }
    const format = detectImageFormat(data)
    if (!format) {
        throw new QzoneValidationError(`图片 ${name} 的文件签名不受支持`)
    }
    const dimensions = readImageDimensions(data, format)
    if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
        throw new QzoneValidationError(`无法读取图片 ${name} 的有效尺寸`)
    }
    if (Math.min(dimensions.width, dimensions.height) < MIN_IMAGE_SIDE) {
        throw new QzoneValidationError(
            `图片 ${name} 的最短边不能小于 ${MIN_IMAGE_SIDE} 像素`
        )
    }

    return Object.freeze({
        data,
        name,
        ...dimensions,
        qqType: qqImageType(format)
    })
}

async function copyImageData(value: unknown): Promise<Uint8Array> {
    try {
        if (value instanceof Uint8Array) {
            return new Uint8Array(value)
        }
        if (value instanceof ArrayBuffer) {
            return new Uint8Array(value.slice(0))
        }
        if (value instanceof Blob) {
            return new Uint8Array(await value.arrayBuffer())
        }
    } catch (cause) {
        throw new QzoneValidationError('无法读取发布图片数据', { cause })
    }
    throw new QzoneValidationError(
        '发布图片数据必须是 Uint8Array、ArrayBuffer 或 Blob'
    )
}

type ImageFormat = 'jpeg' | 'png' | 'gif' | 'bmp' | 'webp'

function detectImageFormat(data: Uint8Array): ImageFormat | null {
    if (startsWith(data, [0xff, 0xd8, 0xff])) {
        return 'jpeg'
    }
    if (startsWith(data, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
        return 'png'
    }
    const signature = ascii(data, 0, 6)
    if (signature === 'GIF87a' || signature === 'GIF89a') {
        return 'gif'
    }
    if (ascii(data, 0, 2) === 'BM') {
        return 'bmp'
    }
    if (ascii(data, 0, 4) === 'RIFF' && ascii(data, 8, 4) === 'WEBP') {
        return 'webp'
    }
    return null
}

function readImageDimensions(
    data: Uint8Array,
    format: ImageFormat
): { readonly width: number; readonly height: number } | null {
    switch (format) {
        case 'png':
            return data.length >= 24 && ascii(data, 12, 4) === 'IHDR'
                ? {
                      width: uint32(data, 16, false),
                      height: uint32(data, 20, false)
                  }
                : null
        case 'gif':
            return data.length >= 10
                ? {
                      width: uint16(data, 6, true),
                      height: uint16(data, 8, true)
                  }
                : null
        case 'bmp':
            return data.length >= 26
                ? {
                      width: Math.abs(int32(data, 18, true)),
                      height: Math.abs(int32(data, 22, true))
                  }
                : null
        case 'jpeg':
            return readJpegDimensions(data)
        case 'webp':
            return readWebpDimensions(data)
    }
}

function readJpegDimensions(
    data: Uint8Array
): { readonly width: number; readonly height: number } | null {
    let index = 2
    while (index + 1 < data.length) {
        if (data[index] !== 0xff) {
            index += 1
            continue
        }
        while (data[index] === 0xff) {
            index += 1
        }
        const marker = data[index]
        index += 1
        if (marker === undefined || marker === 0xd9 || marker === 0xda) {
            return null
        }
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
            continue
        }
        if (index + 2 > data.length) {
            return null
        }
        const length = uint16(data, index, false)
        if (length < 2 || index + length > data.length) {
            return null
        }
        if (isStartOfFrame(marker) && length >= 7) {
            return {
                width: uint16(data, index + 5, false),
                height: uint16(data, index + 3, false)
            }
        }
        index += length
    }
    return null
}

function isStartOfFrame(marker: number): boolean {
    return [
        0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce,
        0xcf
    ].includes(marker)
}

function readWebpDimensions(
    data: Uint8Array
): { readonly width: number; readonly height: number } | null {
    const chunk = ascii(data, 12, 4)
    if (chunk === 'VP8X' && data.length >= 30) {
        return {
            width: 1 + uint24(data, 24),
            height: 1 + uint24(data, 27)
        }
    }
    if (chunk === 'VP8 ' && data.length >= 30) {
        return {
            width: uint16(data, 26, true) & 0x3fff,
            height: uint16(data, 28, true) & 0x3fff
        }
    }
    if (chunk === 'VP8L' && data.length >= 25 && data[20] === 0x2f) {
        const value = uint32(data, 21, true)
        return {
            width: 1 + (value & 0x3fff),
            height: 1 + ((value >>> 14) & 0x3fff)
        }
    }
    return null
}

function qqImageType(format: ImageFormat): number {
    switch (format) {
        case 'gif':
            return 2
        case 'png':
            return 3
        case 'bmp':
            return 4
        default:
            return 1
    }
}

function startsWith(data: Uint8Array, bytes: readonly number[]): boolean {
    return bytes.every((value, index) => data[index] === value)
}

function ascii(data: Uint8Array, offset: number, length: number): string {
    if (offset < 0 || offset + length > data.length) {
        return ''
    }
    return String.fromCharCode(...data.subarray(offset, offset + length))
}

function uint16(
    data: Uint8Array,
    offset: number,
    littleEndian: boolean
): number {
    return new DataView(
        data.buffer,
        data.byteOffset,
        data.byteLength
    ).getUint16(offset, littleEndian)
}

function uint24(data: Uint8Array, offset: number): number {
    return (
        (data[offset] ?? 0) |
        ((data[offset + 1] ?? 0) << 8) |
        ((data[offset + 2] ?? 0) << 16)
    )
}

function uint32(
    data: Uint8Array,
    offset: number,
    littleEndian: boolean
): number {
    return new DataView(
        data.buffer,
        data.byteOffset,
        data.byteLength
    ).getUint32(offset, littleEndian)
}

function int32(
    data: Uint8Array,
    offset: number,
    littleEndian: boolean
): number {
    return new DataView(data.buffer, data.byteOffset, data.byteLength).getInt32(
        offset,
        littleEndian
    )
}
