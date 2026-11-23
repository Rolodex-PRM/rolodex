import { useCallback, useEffect, useState } from 'react'
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { SwitchRow } from '../../../src/admin-fields'
import { api, download, send } from '../../../src/api'
import { useAuth } from '../../../src/auth'
import { CronSchedule } from '../../../src/cron-schedule'
import { DEFAULT_BACKUP_CRON } from '../../../src/cron'
import { Loader } from '../../../src/logo'
import { font, theme } from '../../../src/theme'
import { Button, Field, Notice } from '../../../src/ui'

const DOCS = 'https://rolodex-prm.github.io/rolodex/backup/backup-guide.html'

type BackupStats = {
  users: number
  workspaces: number
  contacts: number
  trashedContacts: number
  interactions: number
  notes: number
  relationships: number
  attachments: number
}

type BackupPolicy = {
  enabled: boolean
  cron: string
  retain: number
  lastRunAt: string | null
}

type BackupRow = {
  id: string
  createdAt: string
  sizeBytes: number
  applicationVersion: string
  formatVersion: number
  stats: BackupStats | null
}

type BackupList = {
  policy: BackupPolicy
  backups: BackupRow[]
  canManage: boolean
}

type RestorePhase = 'confirm' | 'running' | 'restarting'

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(2)} MB`
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatWhen(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function formatCount(value: number) {
  return value.toLocaleString()
}

export default function BackupRecoveryPage() {
  const { workspace } = useAuth()
  const [rows, setRows] = useState<BackupRow[]>([])
  const [policy, setPolicy] = useState<BackupPolicy>({ enabled: false, cron: DEFAULT_BACKUP_CRON, retain: 7, lastRunAt: null })
  const [canManage, setCanManage] = useState(false)
  const [retainDraft, setRetainDraft] = useState('7')
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [restoreId, setRestoreId] = useState('')
  const [restorePhase, setRestorePhase] = useState<RestorePhase | null>(null)

  const load = useCallback(() => {
    api<BackupList>('/api/backups')
      .then((payload) => {
        setRows(payload.backups)
        setPolicy(payload.policy)
        setRetainDraft(String(payload.policy.retain))
        setCanManage(payload.canManage)
      })
      .catch((caught: Error) => setError(caught.message))
  }, [])

  useEffect(() => {
    load()
  }, [load, workspace?.id])

  const restoreTarget = rows.find((row) => row.id === restoreId) ?? null

  async function createBackup() {
    setError('')
    setNotice('')
    setBusy('create')
    try {
      await send('/api/backups', 'POST')
      setNotice('Backup created')
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Backup failed')
    } finally {
      setBusy('')
    }
  }

  async function savePolicy(next: BackupPolicy) {
    setError('')
    setNotice('')
    const previous = policy
    setPolicy(next)
    try {
      const saved = await send<BackupPolicy>('/api/backups/policy', 'PUT', {
        enabled: next.enabled,
        cron: next.cron,
        retain: next.retain,
      })
      setPolicy(saved)
      setRetainDraft(String(saved.retain))
      setNotice('Backup schedule saved')
    } catch (caught) {
      setPolicy(previous)
      setError(caught instanceof Error ? caught.message : 'Could not save schedule')
    }
  }

  async function removeBackup(id: string) {
    setError('')
    setBusy(`delete:${id}`)
    try {
      await send(`/api/backups/${id}`, 'DELETE')
      setNotice('Backup deleted')
      load()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Delete failed')
    } finally {
      setBusy('')
    }
  }

  function openRestore(id: string) {
    setError('')
    setNotice('')
    setRestoreId(id)
    setRestorePhase('confirm')
  }

  function closeRestore() {
    if (restorePhase === 'running' || restorePhase === 'restarting') return
    setRestoreId('')
    setRestorePhase(null)
  }

  async function confirmRestore() {
    if (!restoreId) return
    setError('')
    setNotice('')
    setRestorePhase('running')
    try {
      await send(`/api/backups/${restoreId}/restore`, 'POST', { confirm: true })
      setRestorePhase('restarting')
      setNotice('Restore finished. The server is restarting — refresh in a few seconds.')
    } catch (caught) {
      setRestorePhase('confirm')
      setError(caught instanceof Error ? caught.message : 'Restore failed')
    }
  }

  async function uploadBackup() {
    if (Platform.OS !== 'web' || typeof document === 'undefined') {
      setError('Upload is available in the web admin')
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.tar.gz,.tgz,application/gzip'
    input.onchange = () => {
      const file = input.files?.[0]
      if (!file) return
      setError('')
      setNotice('')
      setBusy('upload')
      const body = new FormData()
      body.append('file', file)
      void api('/api/backups/upload', { method: 'POST', body })
        .then(() => {
          setNotice('Backup uploaded')
          load()
        })
        .catch((caught: Error) => setError(caught.message))
        .finally(() => setBusy(''))
    }
    input.click()
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Backups</Text>
      <Text style={styles.meta}>
        Complete snapshots of the database and uploaded files. Use these to export data, restore this server, or move to
        another machine. Keep CREDENTIALS_KEY from .env somewhere safe — it is not stored inside backup archives.
      </Text>
      {error ? <Notice text={error} /> : null}
      {notice ? <Text style={styles.notice}>{notice}</Text> : null}

      {canManage ? (
        <View style={styles.actions}>
          <Button label={busy === 'create' ? 'Creating…' : 'Create a backup'} onPress={() => void createBackup()} />
          <Button label={busy === 'upload' ? 'Uploading…' : 'Upload'} tone="ghost" onPress={() => void uploadBackup()} />
        </View>
      ) : (
        <Notice text="Only an owner can create, restore, upload, or change the schedule." />
      )}

      {canManage ? (
        <View style={styles.section}>
          <Text style={styles.subheading}>Automatic backups</Text>
          <SwitchRow
            label="Run backups on a schedule"
            detail={policy.lastRunAt ? `Last run ${formatWhen(policy.lastRunAt)}` : 'No automatic backup has run yet'}
            on={policy.enabled}
            onPress={() => void savePolicy({ ...policy, enabled: !policy.enabled })}
          />
          {policy.enabled ? (
            <CronSchedule value={policy.cron} onChange={(cron) => void savePolicy({ ...policy, cron })} />
          ) : null}
          <Field
            label="Keep this many backups"
            hint="Older backups are deleted automatically after each successful backup."
            value={retainDraft}
            onChangeText={setRetainDraft}
            keyboardType="number-pad"
            onBlur={() => {
              const retain = Math.min(100, Math.max(1, Number(retainDraft) || policy.retain))
              setRetainDraft(String(retain))
              if (retain !== policy.retain) void savePolicy({ ...policy, retain })
            }}
          />
        </View>
      ) : null}

      <View style={styles.section}>
        <Text style={styles.subheading}>Stored backups</Text>
        {rows.length === 0 ? <Text style={styles.meta}>No backups yet.</Text> : null}
        {rows.map((row) => (
          <View key={row.id} style={styles.row}>
            <View style={styles.copy}>
              <Text style={styles.name}>{row.id}</Text>
              <Text style={styles.meta}>
                {formatWhen(row.createdAt)} · {formatBytes(row.sizeBytes)} · v{row.applicationVersion}
              </Text>
            </View>
            <View style={styles.rowActions}>
              <Pressable
                style={styles.chip}
                onPress={() => void download(`/api/backups/${row.id}/download`, `rolodex-${row.id}.tar.gz`, 'GET')}
              >
                <Text style={styles.chipText}>Download</Text>
              </Pressable>
              {canManage ? (
                <>
                  <Pressable style={[styles.chip, styles.chipAccent]} onPress={() => openRestore(row.id)}>
                    <Text style={[styles.chipText, styles.chipAccentText]}>Restore</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.chip, styles.chipDanger]}
                    onPress={() => void removeBackup(row.id)}
                    disabled={busy === `delete:${row.id}`}
                  >
                    <Text style={[styles.chipText, styles.chipDangerText]}>
                      {busy === `delete:${row.id}` ? '…' : 'Delete'}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          </View>
        ))}
      </View>

      <Pressable onPress={() => void Linking.openURL(DOCS)}>
        <Text style={styles.link}>Backup & recovery documentation</Text>
      </Pressable>

      <Modal visible={restorePhase === 'confirm' && !!restoreTarget} transparent animationType="fade" onRequestClose={closeRestore}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Restore this backup?</Text>
            <Text style={styles.warn}>
              This replaces the live database, users, and uploaded files with the contents of this backup. The change
              cannot be undone except by restoring another backup.
            </Text>
            {restoreTarget ? (
              <Text style={styles.meta}>
                {restoreTarget.id} · {formatWhen(restoreTarget.createdAt)} · {formatBytes(restoreTarget.sizeBytes)} · v
                {restoreTarget.applicationVersion}
              </Text>
            ) : null}
            {restoreTarget?.stats ? (
              <View style={styles.stats}>
                <Text style={styles.statsTitle}>In this backup</Text>
                <View style={styles.statsGrid}>
                  <Stat label="Users" value={restoreTarget.stats.users} />
                  <Stat label="Workspaces" value={restoreTarget.stats.workspaces} />
                  <Stat label="Contacts" value={restoreTarget.stats.contacts} />
                  <Stat label="In trash" value={restoreTarget.stats.trashedContacts} />
                  <Stat label="Interactions" value={restoreTarget.stats.interactions} />
                  <Stat label="Notes" value={restoreTarget.stats.notes} />
                  <Stat label="Relationships" value={restoreTarget.stats.relationships} />
                  <Stat label="Attachments" value={restoreTarget.stats.attachments} />
                </View>
              </View>
            ) : (
              <Text style={styles.meta}>Record counts were not stored with this backup.</Text>
            )}
            <View style={styles.modalActions}>
              <Button label="Confirm restore" tone="danger" onPress={() => void confirmRestore()} />
              <Button label="Cancel" tone="ghost" onPress={closeRestore} />
            </View>
          </View>
        </View>
      </Modal>

      <Modal visible={restorePhase === 'running' || restorePhase === 'restarting'} transparent animationType="fade">
        <View style={styles.busyOverlay}>
          <Loader caption={restorePhase === 'restarting' ? 'Restore complete' : 'Restoring backup…'} />
          {restorePhase === 'restarting' ? (
            <Text style={styles.restartText}>The server will restart now. Refresh this page in a few seconds.</Text>
          ) : (
            <Text style={styles.restartText}>Please keep this window open until restore finishes.</Text>
          )}
        </View>
      </Modal>
    </View>
  )
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{formatCount(value)}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 14 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  subheading: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted, fontSize: 14, lineHeight: 20 },
  notice: { fontFamily: font, color: theme.text, fontSize: 14, fontWeight: '600' },
  warn: { fontFamily: font, color: theme.danger, fontSize: 14, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  section: { gap: 10, paddingTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 12,
    gap: 12,
  },
  copy: { gap: 2, flex: 1, minWidth: 0 },
  name: { fontFamily: font, color: theme.text, fontSize: 15, fontWeight: '700' },
  rowActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', flexShrink: 0 },
  chip: { borderWidth: 1, borderColor: theme.text, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  chipAccent: { backgroundColor: theme.text },
  chipAccentText: { color: theme.on },
  chipDanger: { borderColor: theme.danger },
  chipDangerText: { color: theme.danger },
  chipText: { fontFamily: font, color: theme.text, fontSize: 13, fontWeight: '700' },
  link: { fontFamily: font, color: theme.text, fontSize: 14, fontWeight: '700', textDecorationLine: 'underline' },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17, 17, 17, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 520,
    backgroundColor: theme.surface,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: theme.border,
    padding: 20,
    gap: 14,
  },
  modalTitle: { fontFamily: font, color: theme.text, fontSize: 20, fontWeight: '700' },
  modalActions: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingTop: 4 },
  stats: { gap: 10 },
  statsTitle: { fontFamily: font, color: theme.muted, fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  stat: {
    minWidth: 104,
    flexGrow: 1,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    backgroundColor: theme.raised,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 2,
  },
  statValue: { fontFamily: font, color: theme.text, fontSize: 18, fontWeight: '700' },
  statLabel: { fontFamily: font, color: theme.muted, fontSize: 12 },
  busyOverlay: {
    flex: 1,
    backgroundColor: theme.bg,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  restartText: { fontFamily: font, color: theme.muted, fontSize: 15, lineHeight: 22, textAlign: 'center', maxWidth: 360 },
})
