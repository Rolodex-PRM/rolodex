import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { explainPluginManifest, isPluginId } from './manifest'

const command = process.argv[2]
const target = process.argv[3]

if (command === 'create') {
  create(target)
} else if (command === 'validate') {
  const problems = validate(target ? path.resolve(target) : process.cwd())
  if (problems.length) {
    for (const problem of problems) console.error(problem)
    process.exit(1)
  }
  console.log('Plugin manifest is valid')
} else {
  console.error('Usage: rolodex-plugin create <id> | rolodex-plugin validate [directory]')
  process.exit(1)
}

function create(id: string | undefined) {
  if (!id || !isPluginId(id)) {
    console.error('Choose an id of lowercase letters, numbers, and dashes')
    process.exit(1)
  }
  const dir = path.resolve(id)
  if (existsSync(dir)) {
    console.error(`${dir} already exists`)
    process.exit(1)
  }
  const name = id.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ')
  mkdirSync(dir)
  writeFileSync(path.join(dir, 'rolodex-plugin.json'), `${JSON.stringify({
    id,
    name,
    version: '1.0.0',
    description: 'A page that stays inside this plugin.',
    entry: 'index.html',
    rolodex: '>=0.1.0 <1.0.0',
    settings: [],
  }, null, 2)}\n`)
  writeFileSync(path.join(dir, 'index.html'), page(name))
  writeFileSync(path.join(dir, 'README.md'), `# ${name}\n\nA Rolodex plugin page. It can read names and keep its own notes. It cannot change people.\n`)
  console.log(dir)
}

function validate(dir: string) {
  const manifestPath = path.join(dir, 'rolodex-plugin.json')
  if (!existsSync(manifestPath)) return ['Add rolodex-plugin.json']
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    return ['rolodex-plugin.json is not valid JSON']
  }
  const explained = explainPluginManifest(parsed)
  if (!explained.manifest) return explained.problems
  const entryPath = path.resolve(dir, explained.manifest.entry)
  const root = path.resolve(dir)
  if (entryPath !== root && !entryPath.startsWith(`${root}${path.sep}`)) return ['entry stays inside the plugin folder', ...explained.problems]
  if (!existsSync(entryPath) || !statSync(entryPath).isFile()) return [`Add ${explained.manifest.entry}`, ...explained.problems]
  return explained.problems
}

function page(name: string) {
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${name}</title>
</head>
<body>
  <p id="who"></p>
  <textarea id="note" placeholder="Write a note"></textarea>
  <button id="save" type="button">Save note</button>
  <p id="status"></p>
  <script>
    var note = document.getElementById('note')
    var status = document.getElementById('status')
    window.addEventListener('rolodex', function () {
      window.rolodex.me().then(function (person) {
        document.getElementById('who').textContent = person.displayName
      })
      window.rolodex.get('note').then(function (value) { note.value = value || '' })
    })
    document.getElementById('save').addEventListener('click', function () {
      window.rolodex.set('note', note.value).then(function () { status.textContent = 'Saved in this plugin.' })
    })
  </script>
</body>
</html>
`
}
