type LeafletApi = typeof import('leaflet')

declare global {
  interface Window {
    L?: LeafletApi
  }
}

function ensureStylesheet(id: string, href: string) {
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}

function loadScript(id: string, src: string) {
  const existing = document.getElementById(id)
  if (existing) {
    return new Promise<void>((resolve, reject) => {
      if ((existing as HTMLScriptElement).dataset.loaded === '1') {
        resolve()
        return
      }
      existing.addEventListener('load', () => resolve(), { once: true })
      existing.addEventListener('error', () => reject(new Error(`Could not load ${src}`)), { once: true })
    })
  }
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement('script')
    script.id = id
    script.src = src
    script.async = true
    script.onload = () => {
      script.dataset.loaded = '1'
      resolve()
    }
    script.onerror = () => reject(new Error(`Could not load ${src}`))
    document.head.appendChild(script)
  })
}

/** Load Leaflet from CDN so Metro/pnpm symlink resolution is not required at runtime. */
export async function loadLeaflet() {
  if (window.L) return window.L
  ensureStylesheet('leaflet-css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css')
  await loadScript('leaflet-js', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js')
  if (!window.L) throw new Error('Leaflet did not load')
  return window.L
}

export async function loadLeafletMarkerCluster() {
  const L = await loadLeaflet()
  if ('markerClusterGroup' in L) return L as LeafletApi & { markerClusterGroup: (...args: never[]) => unknown }
  ensureStylesheet('leaflet-markercluster-css', 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.css')
  ensureStylesheet('leaflet-markercluster-default-css', 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/MarkerCluster.Default.css')
  await loadScript('leaflet-markercluster-js', 'https://unpkg.com/leaflet.markercluster@1.5.3/dist/leaflet.markercluster.js')
  return L as LeafletApi & { markerClusterGroup: (...args: never[]) => unknown }
}

export { ensureStylesheet }
