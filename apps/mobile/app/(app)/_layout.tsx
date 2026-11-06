import { Link, Slot, usePathname, useRouter } from 'expo-router'
import { useState } from 'react'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { AiMenu, contactIdFromPath } from '../../src/ai-enrich'
import { SearchPanel } from '../../src/search-panel'
import { useAuth } from '../../src/auth'
import { useColorScheme } from '../../src/color-scheme'
import { Icon } from '../../src/icons'
import { RolodexMark } from '../../src/logo'
import { MobileShell } from '../../src/mobile-shell'
import { PluginBar } from '../../src/plugin-bar'
import { font, theme } from '../../src/theme'

const links = [
  { href: '/contacts', label: 'Contacts' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/interactions', label: 'Interactions' },
  { href: '/tasks', label: 'Tasks' },
] as const

export default function AppLayout() {
  const { session, workspace, workspaces, selectWorkspace, signOut } = useAuth()
  const path = usePathname()
  const router = useRouter()
  const width = useWindowDimensions().width
  const wide = width >= 880
  const wrapBar = width < 1100
  const [menu, setMenu] = useState<'account' | 'ai' | 'search' | null>(null)
  const canManage = workspace?.role === 'owner' || workspace?.role === 'administrator'
  const canWrite = canManage || workspace?.role === 'editor'
  const { scheme, toggleScheme } = useColorScheme()
  const mark = initials(session?.displayName)

  if (!wide) {
    return (
      <MobileShell>
        <Slot />
      </MobileShell>
    )
  }

  return (
    <View style={styles.shell}>
      {menu ? <Pressable accessibilityLabel="Close menu" onPress={() => setMenu(null)} style={styles.backdrop} /> : null}
      <View style={[styles.bar, wrapBar && styles.barNarrow]}>
        <Pressable onPress={() => router.push('/')} style={styles.brand}>
          <RolodexMark size={42} />
          <Text style={styles.brandText}>rolodex</Text>
        </Pressable>
        <View style={styles.links}>
          {links.map((link) => {
            const active = path === link.href || path.startsWith(`${link.href}/`)
            return (
              <Link key={link.href} href={link.href} style={[styles.link, active && styles.linkActive]}>
                {link.label}
              </Link>
            )
          })}
        </View>
        <View style={styles.spacer} />
        <View style={styles.accountSlot}>
          <Pressable accessibilityLabel="AI features" onPress={() => setMenu(menu === 'ai' ? null : 'ai')} style={[styles.scheme, menu === 'ai' && styles.schemeOn]}>
            <Icon name="sparkle" color={theme.text} size={18} />
          </Pressable>
          <Pressable accessibilityLabel={scheme === 'dark' ? 'Dark mode' : 'Light mode'} onPress={toggleScheme} style={styles.scheme}>
            <Icon name={scheme === 'dark' ? 'moon' : 'sun'} color={theme.text} size={18} />
          </Pressable>
          <Pressable accessibilityLabel={session?.displayName || 'Account'} onPress={() => setMenu(menu === 'account' ? null : 'account')} style={[styles.avatar, menu === 'account' && styles.avatarOn]}>
            <Text style={styles.avatarText}>{mark}</Text>
          </Pressable>
          {menu === 'ai' && workspace ? (
            <View style={[styles.menu, styles.aiMenu]}>
              <AiMenu workspaceId={workspace.id} contactId={contactIdFromPath(path)} canWrite={canWrite} canManage={canManage} onOpen={(href) => { setMenu(null); router.push(href) }} />
            </View>
          ) : null}
          {menu === 'account' ? (
            <View style={styles.menu}>
              {workspaces.length > 1 ? workspaces.map((item) => (
                <Pressable key={item.id} onPress={() => { selectWorkspace(item); setMenu(null) }} style={styles.menuRow}>
                  <Text style={[styles.menuText, item.id === workspace?.id && styles.menuTextOn]}>{item.name}</Text>
                </Pressable>
              )) : null}
              <Pressable onPress={() => setMenu('search')} style={styles.menuRow}>
                <Icon name="search" color={theme.text} size={18} />
                <Text style={styles.menuText}>Search</Text>
              </Pressable>
              <Pressable onPress={() => { setMenu(null); router.push('/settings') }} style={styles.menuRow}>
                <Icon name="settings" color={theme.text} size={18} />
                <Text style={styles.menuText}>Settings</Text>
              </Pressable>
              {canManage ? (
                <Pressable onPress={() => { setMenu(null); router.push('/admin') }} style={styles.menuRow}>
                  <Icon name="briefcase" color={theme.text} size={18} />
                  <Text style={styles.menuText}>Admin</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => {
                  void signOut().then(() => router.replace('/sign-in'))
                }}
                style={styles.menuRow}
              >
                <Icon name="logout" color={theme.danger} size={18} />
                <Text style={styles.signOut}>Sign out</Text>
              </Pressable>
            </View>
          ) : null}
          {menu === 'search' ? (
            <View style={styles.searchPop}>
              <ScrollView style={styles.searchScroll} keyboardShouldPersistTaps="handled">
                <SearchPanel onOpen={() => setMenu(null)} />
              </ScrollView>
            </View>
          ) : null}
        </View>
      </View>
      <PluginBar />
      <ScrollView contentContainerStyle={styles.content} style={styles.main}>
        <Slot />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.bg },
  backdrop: { ...StyleSheet.absoluteFill, zIndex: 2 },
  accountSlot: { position: 'relative', zIndex: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  avatar: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.text },
  avatarOn: { opacity: 0.8 },
  avatarText: { color: theme.on, fontFamily: font, fontSize: 13, fontWeight: '700' },
  menu: {
    position: 'absolute',
    top: 46,
    right: 0,
    width: 240,
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 8,
    gap: 2,
    zIndex: 5,
  },
  aiMenu: { width: 320 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, paddingHorizontal: 10, borderRadius: 10 },
  menuText: { color: theme.text, fontFamily: font, fontSize: 15 },
  menuTextOn: { fontWeight: '700' },
  searchPop: {
    position: 'absolute',
    top: 46,
    right: 0,
    width: 420,
    maxHeight: 560,
    backgroundColor: theme.bg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 12,
    zIndex: 5,
  },
  searchScroll: { maxHeight: 520 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    zIndex: 3,
  },
  barNarrow: { flexWrap: 'wrap', gap: 10 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { color: theme.text, fontFamily: font, fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  links: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  link: { color: theme.muted, fontFamily: font, fontSize: 14, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 },
  linkActive: { backgroundColor: theme.text, color: theme.on },
  scheme: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  schemeOn: { backgroundColor: theme.hover },
  spacer: { flex: 1 },
  signOut: { color: theme.danger, fontFamily: font, fontSize: 15, fontWeight: '600' },
  main: { flex: 1 },
  content: { padding: 28, gap: 16, maxWidth: 1120, width: '100%', alignSelf: 'center' },
})

function initials(name?: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0]?.slice(0, 1) ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]?.slice(0, 1) ?? '' : ''
  return `${first}${last}`.toUpperCase()
}
