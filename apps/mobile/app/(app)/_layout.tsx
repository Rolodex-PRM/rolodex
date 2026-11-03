import { Link, Slot, usePathname, useRouter } from 'expo-router'
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { useAuth } from '../../src/auth'
import { useColorScheme } from '../../src/color-scheme'
import { Icon } from '../../src/icons'
import { RolodexMark } from '../../src/logo'
import { MobileShell } from '../../src/mobile-shell'
import { font, theme } from '../../src/theme'

const links = [
  { href: '/', label: 'Contacts' },
  { href: '/organizations', label: 'Organizations' },
  { href: '/interactions', label: 'Interactions' },
  { href: '/tasks', label: 'Tasks' },
  { href: '/books', label: 'Address books' },
  { href: '/settings', label: 'Settings' },
] as const

export default function AppLayout() {
  const { session, workspace, workspaces, selectWorkspace, signOut } = useAuth()
  const path = usePathname()
  const router = useRouter()
  const wide = useWindowDimensions().width >= 880
  const canManage = workspace?.role === 'owner' || workspace?.role === 'administrator'
  const { scheme, toggleScheme } = useColorScheme()
  const nav = [...links.slice(0, -1), ...(canManage ? [{ href: '/admin' as const, label: 'Admin' }] : []), links[links.length - 1]]

  if (!wide) {
    return (
      <MobileShell>
        <Slot />
      </MobileShell>
    )
  }

  return (
    <View style={styles.shell}>
      <View style={[styles.bar, !wide && styles.barNarrow]}>
        <Pressable onPress={() => router.push('/')} style={styles.brand}>
          <RolodexMark size={42} />
          <Text style={styles.brandText}>rolodex</Text>
        </Pressable>
        <View style={styles.links}>
          {nav.map((link) => {
            const active = link.href === '/' ? path === '/' : path.startsWith(link.href)
            return (
              <Link key={link.href} href={link.href} style={[styles.link, active && styles.linkActive]}>
                {link.label}
              </Link>
            )
          })}
        </View>
        <View style={styles.spacer} />
        {workspaces.length > 1 ? (
          <View style={styles.switcher}>
            {workspaces.map((item) => (
              <Pressable key={item.id} onPress={() => selectWorkspace(item)}>
                <Text style={[styles.switch, item.id === workspace?.id && styles.switchActive]}>{item.name}</Text>
              </Pressable>
            ))}
          </View>
        ) : (
          <Text style={styles.workspace}>{workspace?.name}</Text>
        )}
        <Pressable accessibilityLabel={scheme === 'dark' ? 'Dark mode' : 'Light mode'} onPress={toggleScheme} style={styles.scheme}>
          <Icon name={scheme === 'dark' ? 'moon' : 'sun'} color={theme.text} size={18} />
        </Pressable>
        <Text style={styles.user}>{session?.displayName}</Text>
        <Pressable
          onPress={() => {
            void signOut().then(() => router.replace('/sign-in'))
          }}
        >
          <Text style={styles.signOut}>Sign out</Text>
        </Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} style={styles.main}>
        <Slot />
      </ScrollView>
    </View>
  )
}

const styles = StyleSheet.create({
  shell: { flex: 1, backgroundColor: theme.bg },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingHorizontal: 22,
    paddingVertical: 14,
    backgroundColor: theme.surface,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  barNarrow: { flexWrap: 'wrap', gap: 10 },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  brandText: { color: theme.text, fontFamily: font, fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  links: { flexDirection: 'row', gap: 4, flexWrap: 'wrap' },
  link: { color: theme.muted, fontFamily: font, fontSize: 14, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999 },
  linkActive: { backgroundColor: theme.text, color: theme.on },
  scheme: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  spacer: { flex: 1 },
  workspace: { color: theme.muted, fontFamily: font, fontSize: 13 },
  switcher: { flexDirection: 'row', gap: 8 },
  switch: { color: theme.muted, fontFamily: font, fontSize: 13 },
  switchActive: { color: theme.text, fontWeight: '700' },
  user: { color: theme.text, fontFamily: font, fontSize: 13 },
  signOut: { color: theme.muted, fontFamily: font, fontSize: 13 },
  main: { flex: 1 },
  content: { padding: 28, gap: 16, maxWidth: 1120, width: '100%', alignSelf: 'center' },
})
