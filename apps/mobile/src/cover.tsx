import { createElement, useEffect, useRef, useState } from 'react'
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { api, send, type Activity, type ImmichGallery, type Note } from './api'
import { readCoverSeconds } from './cover-timing'
import { font, theme } from './theme'

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4100'

function authHeaders() {
  if (Platform.OS !== 'web' || typeof sessionStorage === 'undefined') return undefined
  const raw = sessionStorage.getItem('rolodex.session')
  const parsed = raw ? (JSON.parse(raw) as { token?: string }) : null
  return parsed?.token ? { Authorization: `Bearer ${parsed.token}` } : undefined
}

export function ContactCover({
  workspaceId,
  contactId,
  mode,
  hasCover,
  revision,
  canWrite,
  onChange,
}: {
  workspaceId: string
  contactId: string
  mode: string
  hasCover: boolean
  revision: string
  canWrite: boolean
  onChange: () => void
}) {
  const [frames, setFrames] = useState<string[]>([])
  const [seconds, setSeconds] = useState(readCoverSeconds)
  const specific = mode === 'image' && hasCover
  const paths = specific ? [`/api/workspaces/${workspaceId}/contacts/${contactId}/cover?v=${encodeURIComponent(revision)}`] : frames

  useEffect(() => {
    const sync = () => setSeconds(readCoverSeconds())
    sync()
    if (typeof window === 'undefined') return
    window.addEventListener('rolodex-cover-seconds', sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener('rolodex-cover-seconds', sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    if (specific) return
    let stop = false
    Promise.all([
      api<ImmichGallery>(`/api/workspaces/${workspaceId}/contacts/${contactId}/immich`).catch(() => null),
      api<Activity[]>(`/api/workspaces/${workspaceId}/activities?contactId=${contactId}`).catch(() => []),
      api<Note[]>(`/api/workspaces/${workspaceId}/contacts/${contactId}/notes`).catch(() => []),
    ]).then(([gallery, activities, notes]) => {
      if (stop) return
      const immich = [
        ...(gallery?.links.flatMap((link) => link.assets.filter((asset) => asset.kind !== 'VIDEO').map((asset) => `/api/workspaces/${workspaceId}/immich/assets/${asset.id}/thumbnail`)) ?? []),
        ...(gallery?.attachments.map((item) => `/api/workspaces/${workspaceId}/immich/assets/${item.assetId}/thumbnail`) ?? []),
      ]
      const files = [...activities, ...notes].flatMap((item) =>
        (item.files ?? []).filter((file) => file.contentType.startsWith('image/')).map((file) => `/api/workspaces/${workspaceId}/files/${file.id}`),
      )
      setFrames([...new Set([...immich, ...files])])
    })
    return () => {
      stop = true
    }
  }, [workspaceId, contactId, specific, revision])

  async function upload(file: File) {
    const body = new FormData()
    body.append('file', file)
    await api(`/api/workspaces/${workspaceId}/contacts/${contactId}/cover`, { method: 'POST', body })
    onChange()
  }

  return (
    <View style={styles.banner} {...{ dataSet: { coverFade: String(seconds), coverFrames: String(paths.length) } }}>
      {paths.length ? <Crossfade paths={paths} seconds={seconds} /> : <View style={styles.empty} />}
      {Platform.OS === 'web'
        ? createElement('div', {
            'data-cover-shade': '1',
            style: {
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              height: '68%',
              background: 'linear-gradient(to bottom, transparent, var(--rx-bg))',
              pointerEvents: 'none',
              zIndex: 1,
            },
          })
        : null}
      {canWrite ? (
        <View style={styles.controls}>
          {Platform.OS === 'web'
            ? createElement('label', { style: { fontFamily: font, fontSize: 12, color: '#fff', cursor: 'pointer' } }, 'Cover photo', createElement('input', {
                type: 'file',
                accept: 'image/*',
                style: { display: 'none' },
                onChange: (event: { target: { files?: FileList | null } }) => {
                  const file = event.target.files?.[0]
                  if (file) void upload(file)
                },
              }))
            : null}
          {hasCover ? (
            <Pressable onPress={() => void send(`/api/workspaces/${workspaceId}/contacts/${contactId}/cover`, 'PUT', { mode: specific ? 'cycle' : 'image' }).then(onChange)}>
              <Text style={styles.control}>{specific ? 'Cycle photos' : 'Use cover photo'}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function Crossfade({ paths, seconds }: { paths: string[]; seconds: number }) {
  const srcs = useFrameSrcs(paths)
  const [index, setIndex] = useState(0)
  const [topOn, setTopOn] = useState(false)
  const [animate, setAnimate] = useState(false)
  const count = paths.length
  const safe = count ? ((index % count) + count) % count : 0
  const baseSrc = srcs[paths[safe] ?? ''] ?? ''
  const topPath = paths[(safe + 1) % Math.max(count, 1)] ?? ''
  const topSrc = srcs[topPath] ?? ''
  const ready = useRef({ base: '', top: '' })
  ready.current = { base: baseSrc, top: topSrc }
  const signature = paths.join('|')

  useEffect(() => {
    setIndex(0)
    setTopOn(false)
    setAnimate(false)
  }, [signature, seconds])

  useEffect(() => {
    if (count < 2 || Platform.OS !== 'web') return
    let cancel = false
    let timer = 0
    let raf = 0
    const ms = seconds * 1000
    const fadeMs = 1000
    function finish() {
      if (cancel) return
      setAnimate(false)
      setTopOn(false)
      setIndex((current) => (current + 1) % count)
      raf = requestAnimationFrame(() => {
        raf = requestAnimationFrame(() => {
          if (!cancel) hold()
        })
      })
    }
    function hold() {
      if (cancel) return
      if (!ready.current.base || !ready.current.top) {
        timer = window.setTimeout(hold, 200)
        return
      }
      timer = window.setTimeout(() => {
        if (cancel) return
        setAnimate(true)
        raf = requestAnimationFrame(() => {
          if (cancel) return
          setTopOn(true)
          timer = window.setTimeout(finish, fadeMs)
        })
      }, ms)
    }
    timer = window.setTimeout(hold, 60)
    return () => {
      cancel = true
      window.clearTimeout(timer)
      window.cancelAnimationFrame(raf)
    }
  }, [count, seconds, signature])

  return (
    <View style={styles.stack}>
      <Frame src={baseSrc} opacity={1} animate={false} />
      {count > 1 ? <Frame src={topSrc} opacity={topOn ? 1 : 0} animate={animate} /> : null}
    </View>
  )
}

function Frame({ src, opacity, animate }: { src: string; opacity: number; animate: boolean }) {
  if (!src || Platform.OS !== 'web') return null
  return createElement('img', {
    src,
    alt: '',
    'data-cover-frame': '1',
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      objectFit: 'cover',
      display: 'block',
      opacity,
      transition: animate ? 'opacity 1s linear' : 'none',
    },
  })
}

function useFrameSrcs(paths: string[]) {
  const [srcs, setSrcs] = useState<Record<string, string>>({})
  const signature = paths.join('\n')
  useEffect(() => {
    let stop = false
    const created: string[] = []
    const list = signature ? signature.split('\n') : []
    setSrcs({})
    for (const path of list) {
      fetch(`${API_URL}${path}`, { headers: authHeaders(), credentials: 'include' })
        .then((response) => (response.ok ? response.blob() : null))
        .then((blob) => {
          if (!blob || stop) return
          const url = URL.createObjectURL(blob)
          created.push(url)
          setSrcs((current) => ({ ...current, [path]: url }))
        })
        .catch(() => undefined)
    }
    return () => {
      stop = true
      for (const url of created) URL.revokeObjectURL(url)
    }
  }, [signature])
  return srcs
}

const styles = StyleSheet.create({
  banner: { height: 220, borderRadius: 18, overflow: 'hidden', backgroundColor: theme.bg, position: 'relative' },
  stack: { ...StyleSheet.absoluteFill },
  empty: { flex: 1, backgroundColor: theme.raised },
  controls: { position: 'absolute', right: 10, top: 10, zIndex: 2, flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: 'rgba(17,17,17,0.55)', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
  control: { fontFamily: font, fontSize: 12, color: '#fff' },
})
