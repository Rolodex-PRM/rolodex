import { createElement, useEffect, useState } from 'react'
import { Platform, StyleSheet, Text, View } from 'react-native'
import { api, ApiError } from './api'
import { font, theme } from './theme'

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000'

function authHeaders() {
  if (Platform.OS !== 'web' || typeof sessionStorage === 'undefined') return undefined
  const raw = sessionStorage.getItem('rolodex.session')
  const parsed = raw ? (JSON.parse(raw) as { token?: string }) : null
  return parsed?.token ? { Authorization: `Bearer ${parsed.token}` } : undefined
}

export function ContactPortrait({
  workspaceId,
  contactId,
  name,
  hasPhoto,
  editing,
  onError,
}: {
  workspaceId: string
  contactId: string
  name: string
  hasPhoto: boolean
  editing: boolean
  onError?: (message: string) => void
}) {
  const [src, setSrc] = useState('')
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!hasPhoto && revision === 0) {
      setSrc('')
      return
    }
    if (Platform.OS !== 'web') return
    let url = ''
    let stop = false
    fetch(`${API_URL}/api/workspaces/${workspaceId}/contacts/${contactId}/photo?v=${revision}`, { headers: authHeaders(), credentials: 'include' })
      .then((response) => (response.ok ? response.blob() : null))
      .then((blob) => {
        if (!blob || stop) return
        url = URL.createObjectURL(blob)
        setSrc(url)
      })
      .catch(() => setSrc(''))
    return () => {
      stop = true
      if (url) URL.revokeObjectURL(url)
    }
  }, [workspaceId, contactId, hasPhoto, revision])

  async function upload(file: File) {
    const body = new FormData()
    body.append('file', file)
    try {
      await api(`/api/workspaces/${workspaceId}/contacts/${contactId}/photo`, { method: 'POST', body })
      setRevision((current) => current + 1)
    } catch (caught) {
      onError?.(caught instanceof ApiError ? caught.message : 'Could not upload the photo')
    }
  }

  const image = src && Platform.OS === 'web'
    ? createElement('img', { src, alt: '', style: { width: 72, height: 72, borderRadius: 36, objectFit: 'cover', border: '3px solid var(--rx-bg)', display: 'block' } })
    : <View style={styles.avatar}><Text style={styles.letter}>{name.slice(0, 1)}</Text></View>

  if (!editing) return image
  return (
    <View style={styles.editor}>
      {image}
      {Platform.OS === 'web'
        ? createElement('label', { style: styles.change }, 'Change photo', createElement('input', {
            type: 'file',
            accept: 'image/*',
            style: { display: 'none' },
            onChange: (event: { target: { files?: FileList | null } }) => {
              const file = event.target.files?.[0]
              if (file) void upload(file)
            },
          }))
        : null}
    </View>
  )
}

const styles = StyleSheet.create({
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: theme.accentMuted, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: theme.bg },
  letter: { fontFamily: font, fontSize: 28, color: theme.text, fontWeight: '700' },
  editor: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  change: { fontFamily: font, fontSize: 14, fontWeight: '600', color: theme.text, cursor: 'pointer' },
})
