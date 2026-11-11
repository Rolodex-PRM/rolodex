(() => {
  const REST_X = [-38, -28, -20, -12, -6, 0]
  const DELAYS = ['0ms', '80ms', '160ms', '240ms', '320ms', '400ms']
  const BASE_W = 240
  const BASE_H = 180
  const BASE_H_WORD = 210

  const inkPalette = {
    frame: '#1B2A4A',
    knob: '#6B9AD8',
    cardFront: '#FFFFFF',
    cardNear: '#D7E4F5',
    cardMid: '#B7CCEA',
    cardFar: '#93B0D9',
    detail: '#1B2A4A',
    lines: '#8AB0D9',
  }

  const paperTone = {
    frame: '#FFFFFF',
    knob: '#C4CAD3',
    cardFront: '#FFFFFF',
    cardNear: '#E8EBF0',
    cardMid: '#C4CAD3',
    cardFar: '#8B95A3',
    detail: '#1B2A4A',
    lines: '#C4CAD3',
  }

  function rgb(hex) {
    const raw = hex.replace('#', '')
    return [0, 2, 4].map((start) => Number.parseInt(raw.slice(start, start + 2), 16) || 0)
  }

  function toHex(channels) {
    return `#${channels.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0')).join('')}`
  }

  function mix(from, to, weight) {
    const left = rgb(from)
    const right = rgb(to)
    return toHex([0, 1, 2].map((index) => left[index] * (1 - weight) + right[index] * weight))
  }

  function isNearGray(hex) {
    const [red, green, blue] = rgb(hex)
    return Math.max(red, green, blue) - Math.min(red, green, blue) < 30
  }

  function logoPalette(accent, tone = 'ink') {
    if (tone === 'paper') {
      if (isNearGray(accent)) return paperTone
      return {
        frame: mix(accent, '#ffffff', 0.92),
        knob: mix(accent, '#ffffff', 0.55),
        cardFront: '#ffffff',
        cardNear: mix(accent, '#ffffff', 0.88),
        cardMid: mix(accent, '#ffffff', 0.72),
        cardFar: mix(accent, '#ffffff', 0.55),
        detail: mix(accent, '#0a0a0a', 0.45),
        lines: mix(accent, '#ffffff', 0.5),
      }
    }
    if (!isNearGray(accent)) {
      return {
        frame: mix(accent, '#0a1220', 0.55),
        knob: mix(accent, '#ffffff', 0.35),
        cardFront: '#ffffff',
        cardNear: mix(accent, '#ffffff', 0.88),
        cardMid: mix(accent, '#ffffff', 0.72),
        cardFar: mix(accent, '#ffffff', 0.52),
        detail: mix(accent, '#0a1220', 0.45),
        lines: mix(accent, '#ffffff', 0.42),
      }
    }
    return inkPalette
  }

  function prefersReducedMotion() {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false
  }

  function faceFill(i, n) {
    if (i === n - 1) return 'var(--rx-front)'
    const t = i / Math.max(1, n - 2)
    if (t < 0.35) return 'var(--rx-far)'
    if (t < 0.7) return 'var(--rx-mid)'
    return 'var(--rx-near)'
  }

  function ensureStyles(uid) {
    const id = `rx-logo-${uid}`
    document.getElementById(id)?.remove()
    const el = document.createElement('style')
    el.id = id
    el.textContent = `
      .rx-${uid} {
        display: block;
        line-height: 0;
        position: relative;
        width: var(--rx-size, ${BASE_W}px);
        height: calc(var(--rx-size, ${BASE_W}px) * ${BASE_H} / ${BASE_W});
        overflow: visible;
      }
      .rx-${uid}[data-word='1'] {
        height: calc(var(--rx-size, ${BASE_W}px) * ${BASE_H_WORD} / ${BASE_W});
      }
      .rx-${uid} .rx-viewport {
        position: absolute;
        left: 0;
        top: 0;
        width: ${BASE_W}px;
        height: ${BASE_H}px;
        transform: scale(var(--rx-scale, 1));
        transform-origin: 0 0;
        perspective: 640px;
        perspective-origin: 50% 38%;
      }
      .rx-${uid}[data-word='1'] .rx-viewport { height: ${BASE_H_WORD}px; }
      .rx-${uid} .rx-scene {
        position: absolute;
        inset: 0;
        transform-style: preserve-3d;
        transform: rotateY(-18deg) rotateX(10deg);
      }
      .rx-${uid} .rx-stand,
      .rx-${uid} .rx-axle {
        position: absolute;
        left: 0;
        top: 0;
        width: ${BASE_W}px;
        height: ${BASE_H}px;
        overflow: visible;
        pointer-events: none;
        transform-style: preserve-3d;
      }
      .rx-${uid} .rx-stand { transform: translateZ(-14px); }
      .rx-${uid} .rx-cards {
        position: absolute;
        left: 69px;
        top: 55px;
        width: 102px;
        height: 86px;
        transform-style: preserve-3d;
      }
      .rx-${uid} .rx-axle { transform: translateZ(10px); }
      .rx-${uid} .rx-card {
        position: absolute;
        inset: 0;
        transform-style: preserve-3d;
        transform: translateZ(var(--z, 0px));
      }
      .rx-${uid} .rx-hinge {
        position: absolute;
        inset: 0;
        transform-style: preserve-3d;
        transform-origin: 50% 0%;
        transform: rotateX(var(--rx, 0deg));
        will-change: transform;
      }
      .rx-${uid} .rx-face {
        position: absolute;
        inset: 0;
        border-radius: 7px;
        backface-visibility: hidden;
        -webkit-backface-visibility: hidden;
        box-shadow: 0 1px 0 rgba(27, 42, 74, 0.08);
      }
      .rx-${uid} .rx-face-front {
        background: var(--face, var(--rx-front));
        border: 0.5px solid rgba(27, 42, 74, 0.1);
      }
      .rx-${uid} .rx-face-back {
        background: var(--rx-mid);
        border: 0.5px solid rgba(27, 42, 74, 0.08);
        transform: rotateX(180deg);
      }
      .rx-${uid} .rx-glyph {
        position: absolute;
        left: 14%;
        top: 16%;
        width: 72%;
        height: 58%;
      }
      .rx-${uid} .rx-glyph svg { width: 100%; height: 100%; display: block; }
      .rx-${uid} .rx-word {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 8px;
        text-align: center;
        font: 650 18px/1 "Syne", "Segoe UI", system-ui, sans-serif;
        letter-spacing: -0.04em;
        color: var(--rx-frame);
        z-index: 4;
      }
      .rx-${uid}[data-motion='intro'] .rx-hinge,
      .rx-${uid}[data-motion='search'] .rx-hinge,
      .rx-${uid}[data-motion='busy'] .rx-hinge {
        animation: rx-flip-${uid} var(--dur, 1.15s) cubic-bezier(.4,.05,.2,1) var(--loop, both);
        animation-delay: var(--d, 0ms);
      }
      .rx-${uid}[data-motion='intro'] .rx-hinge { --dur: 1.2s; --loop: both; }
      .rx-${uid}[data-motion='search'] .rx-hinge { --dur: .75s; --loop: both; }
      .rx-${uid}[data-motion='busy'] .rx-hinge { --dur: 1.15s; --loop: infinite; }
      .rx-${uid}[data-motion='idle'] .rx-hinge { animation: none; }
      @keyframes rx-flip-${uid} {
        from { transform: rotateX(var(--rx, 0deg)); }
        to   { transform: rotateX(calc(var(--rx, 0deg) - 360deg)); }
      }
      @media (prefers-reduced-motion: reduce) {
        .rx-${uid} .rx-hinge { animation: none !important; transform: rotateX(var(--rx, 0deg)) !important; }
        .rx-${uid} .rx-scene { transform: rotateY(-16deg) rotateX(8deg) !important; }
      }
    `
    document.head.appendChild(el)
  }

  let uidCounter = 0

  function mountLogo(host) {
    const uid = `site${++uidCounter}`
    const size = Number.parseFloat(host.dataset.size || '48') || 48
    const variant = host.dataset.variant || 'icon'
    const tone = host.dataset.tone || 'ink'
    const accent = host.dataset.accent || '#111111'
    const animate = host.dataset.animate !== 'false'
    const motionAttr = host.dataset.motion || (animate ? 'intro' : 'idle')
    const reduced = prefersReducedMotion()
    const compact = variant === 'compact'
    const showWordmark = variant === 'full'
    const palette = logoPalette(accent, tone)
    const rests = compact ? [REST_X[0], REST_X[2], REST_X[5]] : REST_X
    const front = rests.length - 1
    const scale = size / BASE_W
    const motion = reduced ? 'idle' : motionAttr

    ensureStyles(uid)

    const cards = rests
      .map((angle, i) => {
        const depth = i === front ? 20 : -6 - (front - i) * 8
        const flipOrder = front - i
        const glyph =
          i === front
            ? `<div class="rx-glyph"><svg viewBox="0 0 80 56" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="18" cy="16" r="10" fill="var(--rx-detail)" /><path d="M2 48 Q2 30 18 30 Q34 30 34 48 Z" fill="var(--rx-detail)" /><rect x="42" y="10" width="34" height="6" rx="3" fill="var(--rx-line)" /><rect x="42" y="24" width="26" height="6" rx="3" fill="var(--rx-line)" /></svg></div>`
            : ''
        return `<div class="rx-card" style="--z:${depth}px;--face:${faceFill(i, rests.length)};z-index:${i + 1}"><div class="rx-hinge" style="--rx:${angle}deg;--d:${DELAYS[flipOrder] || `${flipOrder * 80}ms`}"><div class="rx-face rx-face-front">${glyph}</div><div class="rx-face rx-face-back"></div></div></div>`
      })
      .join('')

    host.innerHTML = `
      <div class="rx-${uid}" data-motion="${motion}" data-word="${showWordmark ? '1' : '0'}" style="--rx-frame:${palette.frame};--rx-knob:${palette.knob};--rx-front:${palette.cardFront};--rx-near:${palette.cardNear};--rx-mid:${palette.cardMid};--rx-far:${palette.cardFar};--rx-detail:${palette.detail};--rx-line:${palette.lines};--rx-size:${size}px;--rx-scale:${scale}" role="img" aria-label="Rolodex">
        <div class="rx-viewport">
          <div class="rx-scene">
            <svg class="rx-stand" viewBox="0 0 ${BASE_W} ${BASE_H}" width="${BASE_W}" height="${BASE_H}" aria-hidden="true">
              <path d="M48 58 L24 168 L216 168 L192 58" fill="none" stroke="var(--rx-frame)" stroke-width="14" stroke-linecap="round" stroke-linejoin="round" opacity="0.2" />
              <path d="M45 55 L20 165 L220 165 L195 55" fill="none" stroke="var(--rx-frame)" stroke-width="11" stroke-linecap="round" stroke-linejoin="round" />
              <path d="M20 165 L220 165" fill="none" stroke="var(--rx-frame)" stroke-width="11" stroke-linecap="round" />
            </svg>
            <div class="rx-cards">${cards}</div>
            <svg class="rx-axle" viewBox="0 0 ${BASE_W} ${BASE_H}" width="${BASE_W}" height="${BASE_H}" aria-hidden="true">
              <rect x="52" y="44" width="136" height="22" rx="11" fill="var(--rx-frame)" />
              <rect x="56" y="47" width="128" height="6" rx="3" fill="var(--rx-knob)" opacity="0.35" />
              <circle cx="39" cy="55" r="15" fill="var(--rx-frame)" />
              <circle cx="201" cy="55" r="15" fill="var(--rx-frame)" />
              <circle cx="39" cy="55" r="5.5" fill="var(--rx-knob)" />
              <circle cx="201" cy="55" r="5.5" fill="var(--rx-knob)" />
            </svg>
          </div>
          ${showWordmark ? '<div class="rx-word">rolodex</div>' : ''}
        </div>
      </div>
    `

    if (!reduced && motion === 'intro') {
      window.setTimeout(() => {
        const mark = host.querySelector(`.rx-${uid}`)
        if (mark) mark.setAttribute('data-motion', 'idle')
      }, 1900)
    }
  }

  document.querySelectorAll('[data-rolodex-logo]').forEach(mountLogo)
})()
