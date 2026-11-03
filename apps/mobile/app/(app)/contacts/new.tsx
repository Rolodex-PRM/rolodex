import { useRouter } from 'expo-router'
import { Text } from 'react-native'
import { ContactForm } from '../../../src/ContactForm'
import { font, theme } from '../../../src/theme'

export default function NewContact() {
  const router = useRouter()
  return (
    <>
      <Text style={{ fontFamily: font, fontSize: 28, fontWeight: '700', color: theme.text }}>New contact</Text>
      <ContactForm onSaved={(id) => router.replace(`/contacts/${id}`)} />
    </>
  )
}
