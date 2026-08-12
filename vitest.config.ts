import { defineConfig } from 'vitest/config'

export default defineConfig({
    test: {
        coverage: {
            reportsDirectory: 'coverage'
        },
        include: ['tests/**/*.spec.ts']
    }
})
