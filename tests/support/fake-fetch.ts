export type FakeFetchHandler = (
    request: Request
) => Response | Promise<Response>

export type FakeFetchStep = Response | FakeFetchHandler

export interface FakeFetch {
    readonly fetch: typeof globalThis.fetch
    readonly calls: readonly Request[]
}

export function createFakeFetch(steps: readonly FakeFetchStep[]): FakeFetch {
    const queue = [...steps]
    const calls: Request[] = []

    const fetch = async (
        input: RequestInfo | URL,
        init?: RequestInit
    ): Promise<Response> => {
        const request = new Request(input, init)
        calls.push(request.clone())

        const step = queue.shift()
        if (step === undefined) {
            throw new Error(
                `Unexpected fetch call: ${request.method} ${request.url}`
            )
        }

        return typeof step === 'function' ? step(request) : step.clone()
    }

    return { fetch, calls }
}
