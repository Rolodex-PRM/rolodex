export type Particle = {
  x: number
  y: number
  vx: number
  vy: number
  hot: number
}

const alpha = 0.3
export const particleColor = `rgba(255, 255, 255, ${alpha})`
export const collisionColor = `rgba(0, 229, 255, ${alpha})`

const reach = 16
const hotFrames = 42

export function createParticles(width: number, height: number) {
  const count = Math.min(90, Math.max(28, Math.round((width * height) / 7000)))
  const particles: Particle[] = []
  for (let index = 0; index < count; index += 1) {
    const angle = Math.random() * Math.PI * 2
    const speed = 0.22 + Math.random() * 0.38
    particles.push({
      x: Math.random() * width,
      y: Math.random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      hot: 0,
    })
  }
  return particles
}

export function stepParticles(particles: Particle[], width: number, height: number) {
  for (const particle of particles) {
    particle.x += particle.vx
    particle.y += particle.vy
    if (particle.x < 0 || particle.x > width) particle.vx *= -1
    if (particle.y < 0 || particle.y > height) particle.vy *= -1
    particle.x = Math.min(width, Math.max(0, particle.x))
    particle.y = Math.min(height, Math.max(0, particle.y))
    if (particle.hot > 0) particle.hot -= 1
  }
  for (let left = 0; left < particles.length; left += 1) {
    for (let right = left + 1; right < particles.length; right += 1) {
      const a = particles[left]
      const b = particles[right]
      if (!a || !b) continue
      const dx = b.x - a.x
      const dy = b.y - a.y
      const distance = Math.hypot(dx, dy)
      if (distance === 0 || distance > reach) continue
      a.hot = hotFrames
      b.hot = hotFrames
      const nx = dx / distance
      const ny = dy / distance
      const overlap = (reach - distance) / 2
      a.x -= nx * overlap
      a.y -= ny * overlap
      b.x += nx * overlap
      b.y += ny * overlap
      const relative = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
      if (relative <= 0) continue
      a.vx -= relative * nx
      a.vy -= relative * ny
      b.vx += relative * nx
      b.vy += relative * ny
    }
  }
}

export function drawParticles(context: CanvasRenderingContext2D, particles: Particle[], width: number, height: number) {
  context.clearRect(0, 0, width, height)
  for (const particle of particles) {
    const neon = particle.hot > 0
    context.fillStyle = neon ? collisionColor : particleColor
    context.shadowBlur = neon ? 14 : 0
    context.shadowColor = collisionColor
    context.beginPath()
    context.arc(particle.x, particle.y, neon ? 2.4 : 1.7, 0, Math.PI * 2)
    context.fill()
  }
  context.shadowBlur = 0
}

export function mountParticles(canvas: HTMLCanvasElement) {
  const context = canvas.getContext('2d')
  if (!context) return () => {}
  let width = 0
  let height = 0
  let particles: Particle[] = []
  const resize = () => {
    const parent = canvas.parentElement
    if (!parent) return
    const bounds = parent.getBoundingClientRect()
    const nextWidth = Math.max(1, bounds.width)
    const nextHeight = Math.max(1, bounds.height)
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.round(nextWidth * ratio)
    canvas.height = Math.round(nextHeight * ratio)
    canvas.style.width = `${nextWidth}px`
    canvas.style.height = `${nextHeight}px`
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    if (Math.abs(nextWidth - width) > 40 || Math.abs(nextHeight - height) > 40 || particles.length === 0) {
      width = nextWidth
      height = nextHeight
      particles = createParticles(width, height)
    } else {
      width = nextWidth
      height = nextHeight
    }
  }
  resize()
  const observer = new ResizeObserver(resize)
  if (canvas.parentElement) observer.observe(canvas.parentElement)
  let frame = 0
  const tick = () => {
    stepParticles(particles, width, height)
    drawParticles(context, particles, width, height)
    frame = window.requestAnimationFrame(tick)
  }
  frame = window.requestAnimationFrame(tick)
  return () => {
    window.cancelAnimationFrame(frame)
    observer.disconnect()
  }
}
