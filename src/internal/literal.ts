import { QzoneParseError } from '../errors.js'

const MAX_LITERAL_LENGTH = 1_000_000
const MAX_LITERAL_DEPTH = 64

export function parseJavaScriptLiteral(value: string): unknown {
    if (value.length > MAX_LITERAL_LENGTH) {
        throw new QzoneParseError('QQ 空间响应字面量过大')
    }

    try {
        return new LiteralParser(value).parse()
    } catch (cause) {
        if (cause instanceof QzoneParseError) {
            throw cause
        }
        throw new QzoneParseError('QQ 空间响应包含不支持的字面量', {
            cause
        })
    }
}

class LiteralParser {
    readonly #source: string
    #offset = 0

    constructor(source: string) {
        this.#source = source
    }

    parse(): unknown {
        const value = this.#parseValue(0)
        this.#skipTrivia()
        if (this.#offset !== this.#source.length) {
            this.#fail()
        }
        return value
    }

    #parseValue(depth: number): unknown {
        if (depth > MAX_LITERAL_DEPTH) {
            throw new QzoneParseError('QQ 空间响应字面量嵌套过深')
        }
        this.#skipTrivia()
        const current = this.#source[this.#offset]
        if (current === '{') {
            return this.#parseObject(depth + 1)
        }
        if (current === '[') {
            return this.#parseArray(depth + 1)
        }
        if (current === '"' || current === "'") {
            return this.#parseString()
        }
        if (current && /[+\-.\d]/u.test(current)) {
            return this.#parseNumber()
        }
        const identifier = this.#parseIdentifier()
        if (identifier === 'true') {
            return true
        }
        if (identifier === 'false') {
            return false
        }
        if (identifier === 'null' || identifier === 'undefined') {
            return null
        }
        if (identifier) {
            return identifier
        }
        this.#fail()
    }

    #parseObject(depth: number): Readonly<Record<string, unknown>> {
        this.#offset += 1
        const result: Record<string, unknown> = Object.create(null)
        this.#skipTrivia()
        if (this.#consume('}')) {
            return result
        }

        while (this.#offset < this.#source.length) {
            const key = this.#parsePropertyKey()
            this.#skipTrivia()
            if (!this.#consume(':')) {
                this.#fail()
            }
            result[key] = this.#parseValue(depth)
            this.#skipTrivia()
            if (this.#consume('}')) {
                return result
            }
            if (!this.#consume(',')) {
                this.#fail()
            }
            this.#skipTrivia()
            if (this.#consume('}')) {
                return result
            }
        }
        this.#fail()
    }

    #parseArray(depth: number): readonly unknown[] {
        this.#offset += 1
        const result: unknown[] = []
        this.#skipTrivia()
        if (this.#consume(']')) {
            return result
        }

        while (this.#offset < this.#source.length) {
            result.push(this.#parseValue(depth))
            this.#skipTrivia()
            if (this.#consume(']')) {
                return result
            }
            if (!this.#consume(',')) {
                this.#fail()
            }
            this.#skipTrivia()
            if (this.#consume(',')) {
                this.#skipTrivia()
                if (!this.#consume(']')) {
                    this.#fail()
                }
                return result
            }
            if (this.#consume(']')) {
                return result
            }
        }
        this.#fail()
    }

    #parsePropertyKey(): string {
        this.#skipTrivia()
        const current = this.#source[this.#offset]
        if (current === '"' || current === "'") {
            return this.#parseString()
        }
        const identifier = this.#parseIdentifier()
        if (identifier) {
            return identifier
        }
        const number = this.#parseNumber()
        return String(number)
    }

    #parseString(): string {
        const quote = this.#source[this.#offset]
        this.#offset += 1
        let result = ''

        while (this.#offset < this.#source.length) {
            const current = this.#source[this.#offset]
            this.#offset += 1
            if (current === quote) {
                return result
            }
            if (current !== '\\') {
                result += current
                continue
            }

            const escape = this.#source[this.#offset]
            this.#offset += 1
            const simple: Readonly<Record<string, string>> = {
                '0': '\0',
                b: '\b',
                f: '\f',
                n: '\n',
                r: '\r',
                t: '\t',
                v: '\v'
            }
            if (escape && Object.hasOwn(simple, escape)) {
                result += simple[escape]
            } else if (escape === 'x') {
                result += this.#parseCodePoint(2)
            } else if (escape === 'u') {
                result += this.#parseUnicodeEscape()
            } else if (escape === '\n') {
                // JavaScript line continuation.
            } else if (escape === '\r') {
                this.#consume('\n')
            } else if (escape) {
                result += escape
            } else {
                this.#fail()
            }
        }
        this.#fail()
    }

    #parseUnicodeEscape(): string {
        if (!this.#consume('{')) {
            return this.#parseCodePoint(4)
        }
        const end = this.#source.indexOf('}', this.#offset)
        if (end < 0) {
            this.#fail()
        }
        const value = this.#source.slice(this.#offset, end)
        if (!/^[\da-f]{1,6}$/iu.test(value)) {
            this.#fail()
        }
        this.#offset = end + 1
        return String.fromCodePoint(Number.parseInt(value, 16))
    }

    #parseCodePoint(length: number): string {
        const value = this.#source.slice(this.#offset, this.#offset + length)
        if (value.length !== length || !/^[\da-f]+$/iu.test(value)) {
            this.#fail()
        }
        this.#offset += length
        return String.fromCodePoint(Number.parseInt(value, 16))
    }

    #parseNumber(): number {
        const match =
            /^[+-]?(?:0[xX][\da-f]+|(?:(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?))/u.exec(
                this.#source.slice(this.#offset)
            )
        if (!match) {
            this.#fail()
        }
        this.#offset += match[0].length
        const value = Number(match[0])
        if (!Number.isFinite(value)) {
            this.#fail()
        }
        return value
    }

    #parseIdentifier(): string {
        const match = /^[A-Za-z_$][\w$]*/u.exec(
            this.#source.slice(this.#offset)
        )
        if (!match) {
            return ''
        }
        this.#offset += match[0].length
        return match[0]
    }

    #skipTrivia(): void {
        while (this.#offset < this.#source.length) {
            const rest = this.#source.slice(this.#offset)
            const whitespace = /^\s+/u.exec(rest)
            if (whitespace) {
                this.#offset += whitespace[0].length
                continue
            }
            if (rest.startsWith('//')) {
                const end = rest.search(/[\r\n]/u)
                this.#offset += end < 0 ? rest.length : end
                continue
            }
            if (rest.startsWith('/*')) {
                const end = rest.indexOf('*/', 2)
                if (end < 0) {
                    this.#fail()
                }
                this.#offset += end + 2
                continue
            }
            break
        }
    }

    #consume(value: string): boolean {
        if (!this.#source.startsWith(value, this.#offset)) {
            return false
        }
        this.#offset += value.length
        return true
    }

    #fail(): never {
        throw new SyntaxError(`Unsupported literal at offset ${this.#offset}`)
    }
}
