import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const requiredPackageFiles = [
    'LICENSE',
    'README.md',
    'dist/index.cjs',
    'dist/index.cjs.map',
    'dist/index.d.cts',
    'dist/index.d.ts',
    'dist/index.js',
    'dist/index.js.map',
    'package.json'
]
const forbiddenPackagePrefixes = [
    '.codegraph/',
    'coverage/',
    'scripts/',
    'src/',
    'tests/',
    'tmp/'
]
const publicRuntimeExports = [
    'QzoneAuthError',
    'QzoneCancelledError',
    'QzoneClient',
    'QzoneError',
    'QzoneParseError',
    'QzonePermissionError',
    'QzoneRateLimitError',
    'QzoneRequestError',
    'QzoneValidationError'
]

verifyBuildPaths()
verifyPublishedPackage()

console.log('Package contents and ESM/CommonJS imports are valid.')

function verifyBuildPaths() {
    for (const path of requiredPackageFiles.filter((file) =>
        file.startsWith('dist/')
    )) {
        const contents = readFileSync(join(packageRoot, path), 'utf8')
        assertNoAbsolutePath(contents, path)

        if (path.endsWith('.map')) {
            const sourceMap = JSON.parse(contents)
            for (const source of sourceMap.sources ?? []) {
                assert.ok(
                    !isAbsoluteOrFileUrl(source),
                    `${path} contains absolute source path ${source}`
                )
            }
        }
    }

    assert.equal(
        readFileSync(join(packageRoot, 'dist/index.d.ts'), 'utf8'),
        readFileSync(join(packageRoot, 'dist/index.d.cts'), 'utf8'),
        'ESM and CommonJS declarations differ'
    )
}

function verifyPublishedPackage() {
    const consumerRoot = mkdtempSync(join(tmpdir(), 'qzone-sdk-smoke-'))
    try {
        const output = runNpm(
            [
                'pack',
                '--json',
                '--ignore-scripts',
                '--pack-destination',
                consumerRoot
            ],
            packageRoot
        )
        const [packResult] = JSON.parse(output)
        assert.ok(packResult, 'npm pack did not return package metadata')
        verifyPackageContents(packResult.files)

        writeFileSync(
            join(consumerRoot, 'package.json'),
            JSON.stringify({ private: true }),
            'utf8'
        )
        runNpm(
            [
                'install',
                '--ignore-scripts',
                '--no-audit',
                '--no-fund',
                '--package-lock=false',
                join(consumerRoot, packResult.filename)
            ],
            consumerRoot
        )

        const esmPath = join(consumerRoot, 'esm-smoke.mjs')
        const cjsPath = join(consumerRoot, 'cjs-smoke.cjs')
        writeFileSync(esmPath, runtimeAssertionSource('import'), 'utf8')
        writeFileSync(cjsPath, runtimeAssertionSource('require'), 'utf8')

        execFileSync(process.execPath, [esmPath], { stdio: 'inherit' })
        execFileSync(process.execPath, [cjsPath], { stdio: 'inherit' })
        verifyTypeImports(consumerRoot)
    } finally {
        rmSync(consumerRoot, { recursive: true, force: true })
    }
}

function verifyTypeImports(consumerRoot) {
    const source = [
        "import { QzoneClient, QzoneValidationError } from 'qzone-sdk'",
        "import type { QzoneClientOptions, QzoneErrorCode } from 'qzone-sdk'",
        "const code: QzoneErrorCode = new QzoneValidationError('invalid').code",
        'const create = (options: QzoneClientOptions) => new QzoneClient(options)',
        'void code',
        'void create'
    ].join('\n')
    const esmTypePath = join(consumerRoot, 'esm-smoke.mts')
    const cjsTypePath = join(consumerRoot, 'cjs-smoke.cts')
    writeFileSync(esmTypePath, source, 'utf8')
    writeFileSync(cjsTypePath, source, 'utf8')

    const tscPath = join(
        packageRoot,
        'node_modules',
        'typescript',
        'bin',
        'tsc'
    )
    execFileSync(
        process.execPath,
        [
            tscPath,
            '--noEmit',
            '--strict',
            '--skipLibCheck',
            '--target',
            'ES2022',
            '--module',
            'NodeNext',
            '--moduleResolution',
            'NodeNext',
            esmTypePath,
            cjsTypePath
        ],
        { cwd: consumerRoot, stdio: 'inherit' }
    )
}

function verifyPackageContents(entries) {
    const files = new Set(entries.map(({ path }) => path.replaceAll('\\', '/')))
    for (const path of requiredPackageFiles) {
        assert.ok(files.has(path), `published package is missing ${path}`)
    }
    for (const path of files) {
        assert.ok(
            !forbiddenPackagePrefixes.some((prefix) => path.startsWith(prefix)),
            `published package contains forbidden path ${path}`
        )
    }
}

function runtimeAssertionSource(moduleKind) {
    const prelude =
        moduleKind === 'import'
            ? [
                  "import assert from 'node:assert/strict'",
                  "const sdk = await import('qzone-sdk')"
              ]
            : [
                  "const assert = require('node:assert/strict')",
                  "const sdk = require('qzone-sdk')"
              ]
    return [
        ...prelude,
        `const expected = ${JSON.stringify(publicRuntimeExports)}`,
        'assert.deepEqual(Object.keys(sdk).sort(), expected.sort())',
        "assert.equal(new sdk.QzoneValidationError('invalid').code, 'QZONE_VALIDATION')",
        "assert.equal(typeof sdk.QzoneClient, 'function')"
    ].join('\n')
}

function assertNoAbsolutePath(contents, path) {
    const packagePaths = [
        packageRoot,
        packageRoot.replaceAll('\\', '/'),
        packageRoot.replaceAll('/', '\\')
    ]
    for (const localPath of packagePaths) {
        assert.ok(
            !contents.includes(localPath),
            `${path} exposes the local package path`
        )
    }
    assert.ok(
        !/(?:file:\/\/\/|(?:^|[^A-Za-z])[A-Za-z]:[\\/])/mu.test(contents),
        `${path} contains a local absolute path`
    )
}

function isAbsoluteOrFileUrl(path) {
    return (
        path.startsWith('file:') ||
        path.startsWith('/') ||
        /^[A-Za-z]:[\\/]/u.test(path)
    )
}

function runNpm(args, cwd) {
    const options = {
        cwd,
        encoding: 'utf8',
        env: npmEnvironment()
    }
    if (process.platform !== 'win32') {
        return execFileSync('npm', args, options)
    }

    const npmCli = join(
        dirname(process.execPath),
        'node_modules',
        'npm',
        'bin',
        'npm-cli.js'
    )
    return execFileSync(process.execPath, [npmCli, ...args], options)
}

function npmEnvironment() {
    const environment = { ...process.env }
    const inheritedYarnOptions = new Set([
        'npm_config_argv',
        'npm_config_version_commit_hooks',
        'npm_config_version_git_message',
        'npm_config_version_git_tag',
        'npm_config_version_tag_prefix'
    ])
    for (const name of Object.keys(environment)) {
        if (inheritedYarnOptions.has(name.toLowerCase())) {
            delete environment[name]
        }
    }
    return environment
}
