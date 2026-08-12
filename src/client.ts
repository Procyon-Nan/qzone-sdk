import { SessionState } from './session/session.js'
import type {
    QzoneClientOptions,
    QzoneSession,
    QzoneSessionInput,
    SessionInfo
} from './types.js'

export class QzoneClient {
    readonly #session: SessionState

    constructor(options: QzoneClientOptions) {
        this.#session = new SessionState(options.session, {
            onSessionChange: options.onSessionChange
        })
    }

    getSessionInfo(): SessionInfo {
        return this.#session.getInfo()
    }

    exportSession(): QzoneSession {
        return this.#session.export()
    }

    updateSession(session: QzoneSessionInput): Promise<void> {
        return this.#session.update(session)
    }

    clearSession(): void {
        this.#session.clear()
    }
}
