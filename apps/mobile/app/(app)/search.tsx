import { StyleSheet, Text, View } from 'react-native'
import { SearchPanel } from '../../src/search-panel'
import { font, theme } from '../../src/theme'

export default function Search() {
  return (
    <View style={styles.page}>
      <Text style={styles.title}>Search</Text>
      <SearchPanel />
    </View>
  )
}

const styles = StyleSheet.create({
  page: { gap: 12 },
  title: { fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text },
})
