import { useRouter, usePathname } from 'expo-router'
import { useEffect, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { agendaLines } from './agenda'
import { api, type Agenda } from './api'
import { useAccent } from './accent'
import { useAuth } from './auth'
import { useColorScheme } from './color-scheme'
import { AiMenu, contactIdFromPath } from './ai-enrich'
import { Icon } from './icons'
import { RolodexMark } from './logo'
import { PluginBar } from './plugin-bar'
import { font, theme } from './theme'

type Menu = 'notifications' | 'ai' | 'profile' | 'more' | 'create' | null

const moreLinks = [
  { href: '/search', label: 'Search', icon: 'search' },
  { href: '/calendar', label: 'Calendar', icon: 'calendar' },
  { href: '/tasks', label: 'Tasks', icon: 'task' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
] as const

export function MobileShell({ children }: { children: ReactNode }) {
  const { session, workspace, workspaces, selectWorkspace, signOut } = useAuth()
  const canManage = workspace?.role === 'owner' || workspace?.role === 'administrator'
  const canWrite = canManage || workspace?.role === 'editor'
  const menuLinks = [...moreLinks, ...(canManage ? [{ href: '/admin', label: 'Admin', icon: 'briefcase' as const }] : [])]
  const { accent, onAccent } = useAccent()
  const { scheme, toggleScheme } = useColorScheme()
  const router = useRouter()
  const path = usePathname()
  const insets = useSafeAreaInsets()
  const [menu, setMenu] = useState<Menu>(null)
  const [agenda, setAgenda] = useState<Agenda | null>(null)
  const [shown, setShown] = useState(true)
  const lastY = useRef(0)

  useEffect(() => {
    setMenu(null)
  }, [path])

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return
    const node = document.createElement('style')
    node.textContent = '[data-rolodex-row]:hover{background-color:var(--rx-hover)}'
    document.head.appendChild(node)
    return () => node.remove()
  }, [])

  useEffect(() => {
    if (menu !== 'notifications' || !workspace) return
    api<Agenda>(`/api/workspaces/${workspace.id}/agenda`).then(setAgenda).catch(() => setAgenda({ dates: [], tasks: [], reminders: [], reachOuts: [] }))
  }, [menu, workspace])

  function toggle(next: Menu) {
    setMenu((current) => (current === next ? null : next))
  }

  function onScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const y = event.nativeEvent.contentOffset.y
    const delta = y - lastY.current
    if (y < 8) setShown(true)
    else if (delta > 10) {
      setShown(false)
      setMenu((current) => (current === 'more' ? current : null))
    } else if (delta < -10) setShown(true)
    lastY.current = y
  }

  const initial = initials(session?.displayName)

  return (
    <View style={styles.shell}>
      {menu ? <Pressable style={styles.backdrop} onPress={() => setMenu(null)} /> : null}
      <View style={[styles.headerClip, { height: shown ? 64 + insets.top : 0, paddingTop: shown ? insets.top : 0 }]}>
        <View style={styles.header}>
          <Pressable onPress={() => router.push('/')} style={styles.logoButton}>
            <RolodexMark size={28} tone="paper" />
          </Pressable>
          <View style={styles.headerActions}>
            <Pressable accessibilityLabel="AI features" onPress={() => toggle('ai')} style={[styles.iconButton, menu === 'ai' && styles.iconButtonOn]}>
              <Icon name="sparkle" color={theme.text} size={20} />
            </Pressable>
            <Pressable accessibilityLabel="Notifications" onPress={() => toggle('notifications')} style={[styles.iconButton, menu === 'notifications' && styles.iconButtonOn]}>
              <Icon name="bell" color={theme.text} size={20} />
            </Pressable>
            <Pressable onPress={() => toggle('profile')} style={[styles.avatar, menu === 'profile' && styles.avatarOn]}>
              <Text style={styles.avatarText}>{initial}</Text>
            </Pressable>
          </View>
        </View>
      </View>
      {shown ? <PluginBar /> : null}
      {menu === 'ai' && workspace ? (
        <View style={[styles.popover, styles.popoverRight, { top: 64 + insets.top + 8 }]}>
          <AiMenu workspaceId={workspace.id} contactId={contactIdFromPath(path)} canWrite={canWrite} canManage={canManage} onOpen={(href) => { setMenu(null); router.push(href) }} />
        </View>
      ) : null}
      {menu === 'notifications' ? (
        <View style={[styles.popover, styles.popoverRight, { top: 64 + insets.top + 8 }]}>
          <Text style={styles.popoverTitle}>Notifications</Text>
          {agenda && agendaLines(agenda).length ? agendaLines(agenda).map((line) => (
            <MenuRow key={line.key} onPress={() => router.push(line.href)}>
              <Text style={styles.rowText}>{line.label}</Text>
            </MenuRow>
          )) : <Text style={styles.muted}>Nothing new.</Text>}
        </View>
      ) : null}
      {menu === 'profile' ? (
        <View style={[styles.popover, styles.popoverRight, { top: 64 + insets.top + 8 }]}>
          <View style={styles.identity}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initial}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{session?.displayName}</Text>
              <Text style={styles.role}>{workspace?.role}</Text>
              <Text style={styles.muted}>{session?.email}</Text>
            </View>
          </View>
          {workspaces.length > 1 ? (
            <View style={styles.section}>
              {workspaces.map((item) => (
                <MenuRow key={item.id} onPress={() => selectWorkspace(item)}>
                  <Text style={[styles.rowText, item.id === workspace?.id && styles.rowTextOn]}>{item.name}</Text>
                </MenuRow>
              ))}
            </View>
          ) : null}
          {canManage ? (
            <MenuRow
              onPress={() => {
                setMenu(null)
                router.push('/admin')
              }}
            >
              <Icon name="briefcase" color={theme.text} size={18} />
              <Text style={styles.rowText}>Admin</Text>
            </MenuRow>
          ) : null}
          <MenuRow
            onPress={() => {
              setMenu(null)
              router.push('/settings')
            }}
          >
            <Icon name="settings" color={theme.text} size={18} />
            <Text style={styles.rowText}>Settings</Text>
          </MenuRow>
          <MenuRow onPress={toggleScheme}>
            <Icon name={scheme === 'dark' ? 'moon' : 'sun'} color={theme.text} size={18} />
            <Text style={styles.rowText}>{scheme === 'dark' ? 'Dark mode' : 'Light mode'}</Text>
          </MenuRow>
          <MenuRow
            onPress={() => {
              void signOut().then(() => router.replace('/sign-in'))
            }}
          >
            <Icon name="logout" color={theme.danger} size={18} />
            <Text style={styles.danger}>Sign out</Text>
          </MenuRow>
        </View>
      ) : null}
      {!shown ? (
        <Pressable accessibilityLabel="Home" onPress={() => router.push('/')} style={[styles.homeChip, { top: insets.top + 8 }]}>
          <RolodexMark size={22} tone="paper" />
        </Pressable>
      ) : null}
      <ScrollView onScroll={onScroll} scrollEventThrottle={16} style={styles.main} contentContainerStyle={path.startsWith('/plugins/') ? styles.pluginContent : styles.content}>
        {children}
      </ScrollView>
      {menu === 'more' ? (
        <View style={[styles.popover, styles.morePopover, { bottom: 92 + insets.bottom }]}>
          {menuLinks.map((link) => {
            const active = path.startsWith(link.href)
            return (
              <MenuRow key={link.href} onPress={() => router.push(link.href)}>
                <Icon name={link.icon} color={active ? theme.text : theme.muted} size={18} />
                <Text style={[styles.rowText, active && styles.rowTextOn]}>{link.label}</Text>
              </MenuRow>
            )
          })}
        </View>
      ) : null}
      {menu === 'create' ? (
        <View style={[styles.createWrap, { bottom: 128 + insets.bottom }]}>
          <View style={[styles.popover, styles.createPopover, styles.createCard]}>
            <MenuRow onPress={() => router.push('/contacts/new')}>
              <Icon name="contacts" color={theme.text} size={18} />
              <Text style={styles.rowText}>New contact</Text>
            </MenuRow>
            <MenuRow onPress={() => router.push('/interactions')}>
              <Icon name="interactions" color={theme.text} size={18} />
              <Text style={styles.rowText}>New interaction</Text>
            </MenuRow>
            <MenuRow onPress={() => router.push('/tasks')}>
              <Icon name="task" color={theme.text} size={18} />
              <Text style={styles.rowText}>New task</Text>
            </MenuRow>
          </View>
        </View>
      ) : null}
      <View style={[styles.dockWrap, { bottom: 16 + insets.bottom }]}>
        <View style={styles.dock}>
          <DockButton label="Home" icon="home" active={path === '/'} accent={accent} onAccent={onAccent} onPress={() => router.push('/')} />
          <DockButton label="Contacts" icon="contacts" active={path.startsWith('/contacts')} accent={accent} onAccent={onAccent} onPress={() => router.push('/contacts')} />
          <Pressable accessibilityLabel="Add" onPress={() => toggle('create')} style={styles.plus}>
            <Icon name="plus" color={theme.plusIcon} size={24} />
          </Pressable>
          <DockButton label="Interactions" icon="interactions" active={path.startsWith('/interactions')} accent={accent} onAccent={onAccent} onPress={() => router.push('/interactions')} />
          <DockButton label="More" icon="more" active={menu === 'more' || menuLinks.some((link) => path.startsWith(link.href))} accent={accent} onAccent={onAccent} onPress={() => toggle('more')} />
        </View>
      </View>
    </View>
  )
}

const glass = Platform.OS === 'web'
  ? ({
      backgroundColor: 'var(--rx-glass)',
      backdropFilter: 'blur(22px)',
      WebkitBackdropFilter: 'blur(22px)',
      boxShadow: '0 18px 50px rgba(17,17,17,0.14)',
    } as object)
  : { backgroundColor: 'var(--rx-glass)' }

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.bg },
  backdrop: { ...StyleSheet.absoluteFill, zIndex: 2 },
  headerClip: { overflow: 'hidden', zIndex: 4, backgroundColor: theme.header },
  homeChip: { position: 'absolute', left: 16, zIndex: 6, width: 44, height: 44, borderRadius: 14, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  header: { height: 64, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, backgroundColor: theme.header },
  logoButton: { width: 44, height: 44, borderRadius: 14, backgroundColor: theme.ink, alignItems: 'center', justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  iconButton: { width: 42, height: 42, borderRadius: 21, backgroundColor: theme.accentMuted, alignItems: 'center', justifyContent: 'center' },
  iconButtonOn: { backgroundColor: theme.hover },
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#2a2a2a', alignItems: 'center', justifyContent: 'center' },
  avatarOn: { backgroundColor: theme.ink },
  avatarText: { color: '#fff', fontFamily: font, fontWeight: '700', fontSize: 16 },
  main: { flex: 1, zIndex: 1 },
  content: { padding: 16, paddingBottom: 120, gap: 16 },
  pluginContent: { paddingTop: 0, paddingHorizontal: 0, paddingBottom: 120, gap: 0, width: '100%', maxWidth: '100%', alignSelf: 'stretch' },
  dockWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 4 },
  dock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: theme.dock,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: theme.dockBorder,
  },
  dockHit: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  plus: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', marginTop: -12, marginHorizontal: 2, backgroundColor: theme.plus },
  createWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 5 },
  createPopover: { width: 230 },
  createCard: { position: 'relative' },
  popover: { position: 'absolute', width: 280, borderRadius: 22, borderWidth: 1, borderColor: theme.popoverBorder, padding: 14, gap: 8, zIndex: 5, ...glass },
  popoverRight: { right: 12 },
  morePopover: { right: 24 },
  popoverTitle: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text },
  identity: { flexDirection: 'row', gap: 12, alignItems: 'center', paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.line },
  name: { fontFamily: font, fontSize: 16, fontWeight: '700', color: theme.text },
  role: { fontFamily: font, fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: theme.muted },
  muted: { fontFamily: font, color: theme.muted, fontSize: 13 },
  section: { gap: 2, paddingBottom: 8, borderBottomWidth: 1, borderBottomColor: theme.line },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 10 },
  rowHover: { backgroundColor: theme.hover },
  rowText: { fontFamily: font, color: theme.text, fontSize: 15 },
  rowTextOn: { fontWeight: '700' },
  danger: { fontFamily: font, color: theme.danger, fontSize: 15, fontWeight: '600' },
})

const RowButton = Pressable as ComponentType<ComponentProps<typeof Pressable> & { dataSet?: Record<string, string> }>

function MenuRow({ children, onPress }: { children: ReactNode; onPress: () => void }) {
  const [hover, setHover] = useState(false)
  return (
    <RowButton dataSet={{ rolodexRow: '1' }} onPress={onPress} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} style={[styles.row, hover && styles.rowHover]}>
      {children}
    </RowButton>
  )
}

function DockButton({
  label,
  icon,
  active,
  accent,
  onAccent,
  onPress,
}: {
  label: string
  icon: ComponentProps<typeof Icon>['name']
  active: boolean
  accent: string
  onAccent: string
  onPress: () => void
}) {
  const [hover, setHover] = useState(false)
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      style={[styles.dockHit, hover && !active && { backgroundColor: accentTint(accent, 0.16) }, active && { backgroundColor: accent }]}
    >
      <Icon name={icon} color={active ? onAccent : hover ? accent : theme.muted} size={22} />
    </Pressable>
  )
}

function initials(name?: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0]?.slice(0, 1) ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]?.slice(0, 1) ?? '' : ''
  return `${first}${last}`.toUpperCase()
}

function accentTint(hex: string, alpha: number) {
  const raw = hex.replace('#', '')
  if (raw.length !== 6) return `rgba(17, 17, 17, ${alpha})`
  const red = Number.parseInt(raw.slice(0, 2), 16)
  const green = Number.parseInt(raw.slice(2, 4), 16)
  const blue = Number.parseInt(raw.slice(4, 6), 16)
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
