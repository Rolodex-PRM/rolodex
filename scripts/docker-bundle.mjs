import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as esbuild from 'esbuild'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function isPackageSpecifier(id) {
  if (!id || id.startsWith('.') || id.startsWith('/') || id.startsWith('\\')) return false
  if (/^[A-Za-z]:[\\/]/.test(id)) return false
  return true
}

/** Bundle workspace TypeScript; leave npm deps external (including native addons). */
const externalPlugin = {
  name: 'external-npm',
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.kind === 'entry-point') return null
      if (!isPackageSpecifier(args.path)) return null
      if (args.path.startsWith('@rolodex/')) return null
      return { path: args.path, external: true }
    })
  },
}

const outputs = [
  { in: join(root, 'apps/api/src/main.ts'), out: 'apps/api/dist/main' },
  { in: join(root, 'apps/carddav/src/main.ts'), out: 'apps/carddav/dist/main' },
  { in: join(root, 'packages/db/src/migrate.ts'), out: 'packages/db/dist/migrate' },
]

for (const item of outputs) {
  mkdirSync(join(root, dirname(item.out)), { recursive: true })
}

await esbuild.build({
  entryPoints: outputs,
  outdir: root,
  outbase: root,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  plugins: [externalPlugin],
  keepNames: true,
})

console.log('Wrote production bundles under apps/*/dist and packages/db/dist')
