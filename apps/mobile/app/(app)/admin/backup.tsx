import { useMemo, useState } from 'react'
import { Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useAuth } from '../../../src/auth'
import { font, theme } from '../../../src/theme'
import { Notice } from '../../../src/ui'

const DOCS = {
  backup: 'https://rolodex-prm.github.io/rolodex/backup/backup-guide.html',
  restore: 'https://rolodex-prm.github.io/rolodex/backup/restore-guide.html',
  migration: 'https://rolodex-prm.github.io/rolodex/backup/migration-guide.html',
  troubleshooting: 'https://rolodex-prm.github.io/rolodex/backup/troubleshooting.html',
}

const COMMANDS = {
  backup: './scripts/backup.sh',
  verify: './scripts/verify-backup.sh backups/<stamp>',
  restore: './scripts/restore.sh backups/<stamp> --confirm',
}

async function copyText(value: string) {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText && (typeof window === 'undefined' || window.isSecureContext)) {
    try {
      await navigator.clipboard.writeText(value)
      return true
    } catch {
      // fall through
    }
  }
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const area = document.createElement('textarea')
    area.value = value
    area.setAttribute('readonly', '')
    area.style.position = 'absolute'
    area.style.left = '-9999px'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  }
  return false
}

function CommandRow({ label, command, onCopy }: { label: string; command: string; onCopy: (label: string) => void }) {
  return (
    <View style={styles.commandBlock}>
      <Text style={styles.label}>{label}</Text>
      <Text selectable style={styles.code}>
        {command}
      </Text>
      <Pressable onPress={() => void onCopy(label)} style={styles.button}>
        <Text style={styles.buttonText}>Copy</Text>
      </Pressable>
    </View>
  )
}

export default function BackupRecoveryPage() {
  const { workspace } = useAuth()
  const [copied, setCopied] = useState('')
  const isOwner = workspace?.role === 'owner'

  const docsOrigin = useMemo(() => {
    if (Platform.OS === 'web' && typeof window !== 'undefined' && window.location?.origin?.includes('localhost')) {
      return null
    }
    return DOCS
  }, [])

  async function copy(command: string, label: string) {
    const ok = await copyText(command)
    setCopied(ok ? label : '')
    if (ok) setTimeout(() => setCopied(''), 1400)
  }

  function openDoc(url: string) {
    void Linking.openURL(url)
  }

  return (
    <View style={styles.card}>
      <Text style={styles.heading}>Backup & Recovery</Text>
      <Text style={styles.meta}>
        A complete backup is created on the host with Docker Compose scripts. This page explains what to back up and
        shows the commands — it does not run backups inside the browser.
      </Text>
      {!isOwner ? (
        <Notice text="Only an owner should run host backups. Administrators can read this guidance." />
      ) : null}

      <Text style={styles.subheading}>What must be preserved</Text>
      <Text style={styles.meta}>• PostgreSQL database (all people, calendar, tasks, settings, encrypted integration credentials)</Text>
      <Text style={styles.meta}>• Uploads volume (attachments and files under /data)</Text>
      <Text style={styles.meta}>• CREDENTIALS_KEY from .env — store separately; it is never written into the backup archive</Text>
      <Text style={styles.meta}>• docker-compose.yml and .env (or equivalent) so you can recreate the deployment</Text>

      <Text style={styles.subheading}>Host commands</Text>
      <Text style={styles.meta}>Run these from the directory that contains docker-compose.yml (Linux, macOS, WSL, or Git Bash).</Text>
      <CommandRow label={copied === 'backup' ? 'Copied backup command' : 'Create backup'} command={COMMANDS.backup} onCopy={() => void copy(COMMANDS.backup, 'backup')} />
      <CommandRow label={copied === 'verify' ? 'Copied verify command' : 'Verify backup'} command={COMMANDS.verify} onCopy={() => void copy(COMMANDS.verify, 'verify')} />
      <CommandRow label={copied === 'restore' ? 'Copied restore command' : 'Restore (destructive)'} command={COMMANDS.restore} onCopy={() => void copy(COMMANDS.restore, 'restore')} />

      <Text style={styles.subheading}>Database-only download</Text>
      <Text style={styles.meta}>
        Settings → Backup can download a SQL dump of the database when pg_dump is available. That file alone cannot
        restore attachments. Use scripts/backup.sh for a complete, verifiable backup.
      </Text>

      <Text style={styles.subheading}>Encryption key</Text>
      <Text style={styles.meta}>
        If CREDENTIALS_KEY is lost, restored integration credentials stay encrypted and unusable. Keep the key in a
        password manager. Never commit it to git or leave it only inside the backups folder.
      </Text>

      <Text style={styles.subheading}>Documentation</Text>
      <View style={styles.links}>
        {(
          [
            ['Backup guide', DOCS.backup],
            ['Restore guide', DOCS.restore],
            ['Migration guide', DOCS.migration],
            ['Troubleshooting', DOCS.troubleshooting],
          ] as const
        ).map(([label, url]) => (
          <Pressable key={url} onPress={() => openDoc(url)} style={styles.linkButton}>
            <Text style={styles.linkText}>{label}</Text>
          </Pressable>
        ))}
      </View>
      {docsOrigin === null ? (
        <Text style={styles.meta}>Guides are published with the product docs site when this install is online.</Text>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  card: { backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border, borderRadius: 22, padding: 18, gap: 12 },
  heading: { fontFamily: font, fontSize: 22, fontWeight: '700', color: theme.text },
  subheading: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text, marginTop: 8 },
  meta: { fontFamily: font, color: theme.muted, fontSize: 14, lineHeight: 20 },
  label: { fontFamily: font, color: theme.text, fontSize: 13, fontWeight: '700' },
  commandBlock: { gap: 8, borderWidth: 1, borderColor: theme.border, borderRadius: 16, padding: 12 },
  code: {
    fontFamily: font,
    color: theme.text,
    fontSize: 13,
    lineHeight: 18,
    backgroundColor: theme.raised,
    borderRadius: 10,
    padding: 10,
  },
  button: { alignSelf: 'flex-start', borderWidth: 1, borderColor: theme.text, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  buttonText: { fontFamily: font, color: theme.text, fontSize: 14, fontWeight: '700' },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  linkButton: { borderWidth: 1, borderColor: theme.text, borderRadius: 999, paddingVertical: 8, paddingHorizontal: 12 },
  linkText: { fontFamily: font, color: theme.text, fontSize: 14, fontWeight: '700' },
})
