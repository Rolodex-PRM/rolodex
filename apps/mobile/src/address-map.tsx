import { useEffect, useRef } from 'react'
import { Platform, View } from 'react-native'

export function AddressMap({ lat, lon }: { lat: number; lon: number }) {
  const host = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (Platform.OS !== 'web' || !host.current) return
    const node = host.current
    let map: { remove: () => void } | null = null
    let cancel = false
    let timer = 0
    void import('leaflet').then((loaded) => {
      if (cancel || !node.isConnected) return
      const L = ('default' in loaded && loaded.default ? loaded.default : loaded) as typeof import('leaflet')
      ensureStylesheet('leaflet-css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css')
      const view = L.map(node, { zoomControl: false, attributionControl: false, scrollWheelZoom: false }).setView([lat, lon], 14)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(view)
      const icon = L.divIcon({
        className: '',
        html: '<div style="width:14px;height:14px;border-radius:50%;background:#111;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>',
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })
      L.marker([lat, lon], { icon }).addTo(view)
      map = view
      timer = window.setTimeout(() => {
        if (cancel || !node.isConnected) return
        view.invalidateSize()
      }, 50)
    })
    return () => {
      cancel = true
      window.clearTimeout(timer)
      map?.remove()
    }
  }, [lat, lon])

  if (Platform.OS !== 'web') return null
  return <View style={{ height: 140, borderRadius: 12, overflow: 'hidden', marginTop: 8 }} ref={(node) => { host.current = node as unknown as HTMLDivElement }} />
}

function ensureStylesheet(id: string, href: string) {
  if (document.getElementById(id)) return
  const link = document.createElement('link')
  link.id = id
  link.rel = 'stylesheet'
  link.href = href
  document.head.appendChild(link)
}
