import { Link, Slot, usePathname } from 'expo-router'
import { ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native'
import { AdminNavContext } from '../../../src/admin-nav'
import { useAuth } from '../../../src/auth'
import { font, theme } from '../../../src/theme'

const links = [
  { href: '/admin/members' as const, label: 'Users' },
  { href: '/admin/sso' as const, label: 'Sign-in' },
  { href: '/admin/notifications' as const, label: 'Notifications' },
  { href: '/admin/map' as const, label: 'Map' },
  { href: '/admin/relationships' as const, label: 'Relationships' },
  { href: '/admin/addons' as const, label: 'Add-ons' },
  { href: '/admin/appearance' as const, label: 'Appearance' },
]

export default function AdminLayout() {
  const { workspace } = useAuth()
  const path = usePathname()
  const wide = useWindowDimensions().width >= 880
  const canManage = workspace?.role === 'owner' || workspace?.role === 'administrator'

  if (!canManage) {
    return (
      <View style={styles.page}>
        <Text style={styles.title}>Admin</Text>
        <Text style={styles.meta}>Only owners and administrators can change these settings.</Text>
      </View>
    )
  }

  const nav = links.map((link) => {
    const active = path === link.href
    return (
      <Link key={link.href} href={link.href} style={[styles.link, active && styles.linkActive]}>
        {link.label}
      </Link>
    )
  })

  return (
    <AdminNavContext.Provider value={{ refresh: () => {} }}>
      <View style={styles.page}>
        <Text style={styles.title}>Admin</Text>
        <View style={[styles.body, !wide && styles.bodyStacked]}>
          {wide ? <View style={styles.sidebar}>{nav}</View> : <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.sidebarScroll} contentContainerStyle={styles.sidebarRow}>{nav}</ScrollView>}
          <View style={styles.main}>
            <Slot />
          </View>
        </View>
      </View>
    </AdminNavContext.Provider>
  )
}

const styles = StyleSheet.create({
  page: { gap: 16 },
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text },
  meta: { fontFamily: font, color: theme.muted },
  body: { flexDirection: 'row', alignItems: 'flex-start', gap: 22 },
  bodyStacked: { flexDirection: 'column' },
  sidebar: { width: 180, gap: 4 },
  sidebarScroll: { flexGrow: 0, maxHeight: 52 },
  sidebarRow: { gap: 8, alignItems: 'center' },
  link: { color: theme.muted, fontFamily: font, fontSize: 15, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 12, alignSelf: 'flex-start' },
  linkActive: { backgroundColor: theme.text, color: theme.on },
  main: { flex: 1, gap: 14, minWidth: 0 },
})
