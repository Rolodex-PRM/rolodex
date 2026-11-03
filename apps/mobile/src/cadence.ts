export const cadences = [
  { id: '7', label: 'Every week' },
  { id: '14', label: 'Every 2 weeks' },
  { id: '30', label: 'Every month' },
  { id: '90', label: 'Every quarter' },
  { id: '180', label: 'Every 6 months' },
  { id: '365', label: 'Every year' },
] as const

export function cadenceLabel(id: string | null | undefined) {
  return cadences.find((item) => item.id === id)?.label ?? null
}
