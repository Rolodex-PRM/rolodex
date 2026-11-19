#!/usr/bin/env node
/**
 * Gate for staging → main: the release PR must bump the app version,
 * keep workspace package versions in sync, publish that version in the
 * changelog, and stamp the same version on the docs site.
 *
 * Usage:
 *   node scripts/check-release-docs.mjs
 *   node scripts/check-release-docs.mjs --base-ref origin/main
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function parseArgs(argv) {
  let baseRef = process.env.RELEASE_DOCS_BASE_REF || ''
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base-ref') {
      baseRef = argv[i + 1] || ''
      i += 1
    }
  }
  return { baseRef }
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function gitShow(ref, path) {
  try {
    return execFileSync('git', ['show', `${ref}:${path}`], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return null
  }
}

function parseSemver(raw) {
  const match = String(raw).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    text: `${match[1]}.${match[2]}.${match[3]}`,
  }
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major
  if (a.minor !== b.minor) return a.minor - b.minor
  return a.patch - b.patch
}

function workspacePackageJsonPaths() {
  const paths = ['package.json']
  for (const dir of ['apps', 'packages']) {
    const abs = join(root, dir)
    for (const name of readdirSync(abs, { withFileTypes: true })) {
      if (!name.isDirectory()) continue
      paths.push(join(dir, name.name, 'package.json').replaceAll('\\', '/'))
    }
  }
  paths.push('plugin-sdk/package.json')
  return paths
}

function fail(message) {
  console.error(`::error::${message}`)
  process.exitCode = 1
}

function main() {
  const { baseRef } = parseArgs(process.argv.slice(2))
  if (!baseRef) {
    fail('Pass --base-ref (the main branch tip this PR merges into).')
    return
  }

  const headPkg = readJson(join(root, 'package.json'))
  const headVersion = parseSemver(headPkg.version)
  if (!headVersion) {
    fail(`Root package.json version is not semver X.Y.Z: ${headPkg.version}`)
    return
  }

  const baseRaw = gitShow(baseRef, 'package.json')
  if (!baseRaw) {
    fail(`Could not read package.json from ${baseRef}. Fetch the base branch first.`)
    return
  }
  const baseVersion = parseSemver(JSON.parse(baseRaw).version)
  if (!baseVersion) {
    fail(`Base package.json version on ${baseRef} is not semver X.Y.Z.`)
    return
  }

  if (compareSemver(headVersion, baseVersion) <= 0) {
    fail(
      `Release PRs must bump the app version. This branch is ${headVersion.text}; ${baseRef} is already ${baseVersion.text}.`,
    )
  } else {
    console.log(`Version bump ok: ${baseVersion.text} → ${headVersion.text}`)
  }

  for (const rel of workspacePackageJsonPaths()) {
    const pkg = readJson(join(root, rel))
    const parsed = parseSemver(pkg.version)
    if (!parsed || parsed.text !== headVersion.text) {
      fail(`${rel} version is ${pkg.version}; expected ${headVersion.text} to match the root package.`)
    }
  }

  const docsVersionPath = join(root, 'docs', 'version.json')
  let docsVersion
  try {
    docsVersion = parseSemver(readJson(docsVersionPath).version)
  } catch {
    fail('docs/version.json is missing or invalid. It must contain {"version":"X.Y.Z"}.')
    return
  }
  if (!docsVersion || docsVersion.text !== headVersion.text) {
    fail(
      `docs/version.json is ${docsVersion?.text ?? 'invalid'}; expected ${headVersion.text}. Update the docs version with the app release.`,
    )
  } else {
    console.log(`Docs version ok: ${docsVersion.text}`)
  }

  const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  const heading = new RegExp(
    `^## ${headVersion.major}\\.${headVersion.minor}\\.${headVersion.patch} - \\d{4}-\\d{2}-\\d{2}\\s*$`,
    'm',
  )
  if (!heading.test(changelog)) {
    fail(
      `CHANGELOG.md must include a release heading for ${headVersion.text}, for example "## ${headVersion.text} - YYYY-MM-DD", with the notes moved out of Unreleased.`,
    )
  } else {
    console.log(`Changelog heading ok for ${headVersion.text}`)
  }

  if (process.exitCode) {
    console.error('Release docs check failed. Bump package versions, update CHANGELOG.md, and set docs/version.json before merging staging into main.')
    process.exit(process.exitCode)
  }

  console.log('Release docs check passed.')
}

main()
