import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const CARD_W = 62
const R_IN = 7
const R_OUT = 45
const CORNER = 3.5
const STROKE = 2.2
const FRAME_X = CARD_W / 2 + 4.5
const RING_T = 3.2
const APEX_Y = 11
const FLOOR_Y = -49
const SLOPE = (60 * Math.PI) / 180
const BASE_HALF = (APEX_Y - FLOOR_Y) / Math.tan(SLOPE)
const RING_W = 8.5
const ROUND_OUT = [12, 10, 10]
const ROUND_IN = [6, 5, 5]
const RAIL_W = 4.2
const AXLE_W = 3.4
const HUB_R = 4.4
const SLOTS = [0, 34, 54, 74, 94, 218, 240, 262]
const RING = SLOTS.length
const SHADE_STEP = 9
const SHADE_MAX = 34
const YAW = Math.PI / 4
const PITCH = (24 * Math.PI) / 180
const cy = Math.cos(YAW)
const sy = Math.sin(YAW)
const cp = Math.cos(PITCH)
const sp = Math.sin(PITCH)
const SCALE = 1
const CX = 64
const CY = 57
const TONE = { nearRing: 100, nearEdge: 70, rail: 78, farRing: 46, farEdge: 34, axle: 60 }

const ink = '#111111'
const bg = '#ffffff'

function mixHex(a, b, pct) {
  const p = pct / 100
  const parse = (h) => [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16))
  const A = parse(a)
  const B = parse(b)
  return `#${[0, 1, 2].map((i) => Math.round(A[i] * p + B[i] * (1 - p)).toString(16).padStart(2, '0')).join('')}`
}

function project([x, y, z]) {
  const xr = x * cy - z * sy
  const zr = x * sy + z * cy
  const yUp = y * cp - zr * sp
  return [xr, -yUp, zr * cp + y * sp]
}
const toView = (p) => {
  const [x, y] = project(p)
  return [CX + x * SCALE, CY + y * SCALE]
}
const pathOf = (pts) => 'M' + pts.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L') + 'Z'
const projectPath = (pts) => pathOf(pts.map(toView))

function roundedRect(x, y, w, h, r) {
  const pts = []
  const corners = [
    [x + w - r, y + h - r, 0],
    [x + r, y + h - r, 90],
    [x + r, y + r, 180],
    [x + w - r, y + r, 270],
  ]
  for (const [ccx, ccy, start] of corners) {
    for (let i = 0; i <= 5; i++) {
      const a = ((start + (i * 90) / 5) * Math.PI) / 180
      pts.push([ccx + r * Math.cos(a), ccy + r * Math.sin(a)])
    }
  }
  return pts
}
function circle(x, y, r, n = 28) {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * Math.PI * 2
    return [x + r * Math.cos(a), y + r * Math.sin(a)]
  })
}
function roundedPolygon(verts, reach, steps = 8) {
  const out = []
  verts.forEach((v, i) => {
    const prev = verts[(i + verts.length - 1) % verts.length]
    const next = verts[(i + 1) % verts.length]
    const toward = (p, d) => {
      const len = Math.hypot(p[0] - v[0], p[1] - v[1])
      return [v[0] + ((p[0] - v[0]) / len) * d, v[1] + ((p[1] - v[1]) / len) * d]
    }
    const a = toward(prev, reach[i])
    const b = toward(next, reach[i])
    for (let k = 0; k <= steps; k++) {
      const t = k / steps
      out.push([
        (1 - t) ** 2 * a[0] + 2 * (1 - t) * t * v[0] + t ** 2 * b[0],
        (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * v[1] + t ** 2 * b[1],
      ])
    }
  })
  return out
}

const TRI = [
  [0, APEX_Y],
  [-BASE_HALF, FLOOR_Y],
  [BASE_HALF, FLOOR_Y],
]
const INRADIUS = (APEX_Y - FLOOR_Y) / 3
const INCENTER = [0, FLOOR_Y + INRADIUS]
const shrink = (INRADIUS - RING_W) / INRADIUS
const TRI_IN = TRI.map(([z, y]) => [INCENTER[0] + (z - INCENTER[0]) * shrink, INCENTER[1] + (y - INCENTER[1]) * shrink])
const OUTER = roundedPolygon(TRI, ROUND_OUT)
const INNER = roundedPolygon(TRI_IN, ROUND_IN)
const at = (x) => (p) => [x, p[1], p[0]]
const ring = (x) => projectPath(OUTER.map(at(x))) + projectPath(INNER.map(at(x)))
const FAR_RING_EDGE = ring(-FRAME_X - RING_T / 2)
const FAR_RING = ring(-FRAME_X + RING_T / 2)
const NEAR_RING_EDGE = ring(FRAME_X - RING_T / 2)
const NEAR_RING = ring(FRAME_X + RING_T / 2)
const bar = (a, b) => {
  const [p, q] = [toView(a), toView(b)]
  return `M${p[0].toFixed(2)} ${p[1].toFixed(2)}L${q[0].toFixed(2)} ${q[1].toFixed(2)}`
}
const footY = FLOOR_Y + RING_W / 2
const footZ = BASE_HALF - RING_W / 2 / Math.tan(SLOPE / 2)
const BACK_RAIL = bar([-FRAME_X, footY, -footZ], [FRAME_X, footY, -footZ])
const FRONT_RAIL = bar([-FRAME_X, footY, footZ], [FRAME_X, footY, footZ])
const AXLE = bar([-FRAME_X, 0, 0], [FRAME_X, 0, 0])
const HUB = projectPath(circle(0, 0, HUB_R, 32).map(at(FRAME_X + RING_T / 2 + 0.01)))
const HUB_PIN = projectPath(circle(0, 0, HUB_R * 0.4, 20).map(at(FRAME_X + RING_T / 2 + 0.02)))

function slotAngleDeg(s) {
  const i = Math.floor(s) % RING
  const from = SLOTS[i]
  let to = i + 1 < RING ? SLOTS[i + 1] : SLOTS[0] + 360
  if (to < from) to += 360
  return from + (to - from) * (s - Math.floor(s))
}
const onCard = (phi) => (u, v) => [u, v * Math.cos(phi), -v * Math.sin(phi)]
const CARD_OUTLINE = roundedRect(-CARD_W / 2, R_IN, CARD_W, R_OUT - R_IN, CORNER)
const FACE = [
  circle(-CARD_W / 2 + 14, R_OUT - 13, 6.5),
  roundedRect(-CARD_W / 2 + 26, R_OUT - 11.5, 22, 3.6, 1.8),
  roundedRect(-CARD_W / 2 + 26, R_OUT - 18.5, 13, 3.6, 1.8),
  roundedRect(-CARD_W / 2 + 8, R_IN + 9, 44, 3.6, 1.8),
]

function cardsAt(t) {
  const cards = []
  for (let i = 0; i < RING; i++) {
    const s = (((i - t) % RING) + RING) % RING
    const deg = slotAngleDeg(s)
    const f = onCard((deg * Math.PI) / 180)
    const away = Math.min(s, RING - s)
    const faceOpacity = Math.max(0, 1 - away * 1.4)
    cards.push({
      outline: projectPath(CARD_OUTLINE.map(([u, v]) => f(u, v))),
      face: faceOpacity > 0 ? FACE.map((shape) => projectPath(shape.map(([u, v]) => f(u, v)))) : [],
      faceOpacity,
      shade: Math.min(SHADE_MAX, away * SHADE_STEP),
      depth: project(f(0, (R_IN + R_OUT) / 2))[2],
    })
  }
  return cards.sort((a, b) => a.depth - b.depth)
}

const fill = (pct) => mixHex(ink, bg, pct)
const cards = cardsAt(0)
const cardMarkup = cards
  .map((c) => {
    const faces =
      c.face.length > 0
        ? `<g fill="${ink}"${c.faceOpacity < 1 ? ` opacity="${c.faceOpacity}"` : ''}>${c.face.map((d) => `<path d="${d}"/>`).join('')}</g>`
        : ''
    return `<g><path d="${c.outline}" fill="${fill(c.shade)}" stroke="${ink}" stroke-width="${STROKE}" stroke-linejoin="round"/>${faces}</g>`
  })
  .join('')

function svgAt(size, { padded = true } = {}) {
  const pad = padded
    ? `<rect width="128" height="128" fill="${bg}"/>`
    : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${size}" height="${size}">
${pad}
<path d="${FAR_RING_EDGE}" fill="${fill(TONE.farEdge)}" fill-rule="evenodd"/>
<path d="${FAR_RING}" fill="${fill(TONE.farRing)}" fill-rule="evenodd"/>
<path d="${BACK_RAIL}" stroke="${fill(TONE.rail)}" stroke-width="${RAIL_W}" stroke-linecap="round" fill="none"/>
<path d="${AXLE}" stroke="${fill(TONE.axle)}" stroke-width="${AXLE_W}" stroke-linecap="round" fill="none"/>
${cardMarkup}
<path d="${FRONT_RAIL}" stroke="${fill(TONE.rail)}" stroke-width="${RAIL_W}" stroke-linecap="round" fill="none"/>
<path d="${NEAR_RING_EDGE}" fill="${fill(TONE.nearEdge)}" fill-rule="evenodd"/>
<path d="${NEAR_RING}" fill="${fill(TONE.nearRing)}" fill-rule="evenodd"/>
<path d="${HUB}" fill="${bg}"/>
<path d="${HUB_PIN}" fill="${ink}"/>
</svg>`
}

const markSvg = svgAt(512, { padded: false })
const faviconSvg = svgAt(512, { padded: true })

writeFileSync(resolve(root, 'apps/mobile/assets/rolodex-mark.svg'), markSvg)
writeFileSync(resolve(root, 'apps/mobile/assets/_favicon-source.svg'), faviconSvg)
console.log('wrote SVG sources')
