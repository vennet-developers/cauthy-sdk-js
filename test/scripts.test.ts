// The route generator refuses a spec checkout that is not the commit
// spec.lock pins, or that has changes of its own: the table would not be the
// pinned spec's.
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..')
const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function spec(): string {
  const dir = mkdtempSync(join(tmpdir(), 'cauthy-spec-'))
  dirs.push(dir)
  mkdirSync(join(dir, 'protocol'))
  writeFileSync(join(dir, 'VERSION'), '1\n')
  writeFileSync(join(dir, 'protocol/routes.yaml'), 'version: 1\nprefix: /api/auth\nroutes: []\n')
  const git = (...args: string[]) => execFileSync('git', ['-C', dir, '-c', 'user.name=Acme', '-c', 'user.email=dev@example.com', ...args], { stdio: 'pipe' })
  git('init', '-q')
  git('add', '-A')
  git('commit', '-q', '-m', 'spec')
  return dir
}

function generate(specDir: string) {
  const out = join(specDir, 'routes.ts')
  return spawnSync(process.execPath, [join(root, 'scripts/gen-routes.mjs'), out], { env: { ...process.env, SPEC_DIR: specDir }, encoding: 'utf8' })
}

describe('gen-routes', () => {
  it('refuses a spec checkout at another commit than spec.lock pins', () => {
    const r = generate(spec())
    expect(r.status).not.toBe(0)
    expect(r.stderr).toMatch(/spec\.lock pins/)
  })
})
