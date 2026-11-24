import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'

const [tag, output] = process.argv.slice(2)
assert.ok(output, '用法：node scripts/release-notes.mjs <版本标签> <输出文件>')

const { version } = JSON.parse(await readFile('package.json', 'utf8'))
assert.equal(tag, `v${version}`, '版本标签必须与 package.json 版本一致')

const changelog = await readFile('CHANGELOG.md', 'utf8')
const section = changelog
    .split(/^## /mu)
    .find((item) =>
        item.split('\n', 1)[0].trim().endsWith(` version:${version}`)
    )
assert.ok(section, `CHANGELOG.md 缺少 ${version} 的变更记录`)

const notes = section
    .split('\n')
    .slice(1)
    .join('\n')
    .trim()
    .replace(/^- (?:pending|[a-f\d]{7,40}): /gmu, '- ')
assert.ok(notes, `CHANGELOG.md 中 ${version} 的变更记录为空`)
await writeFile(output, `${notes}\n`)
