export type DavRequest = {
  method: string
  path: string
  headers: Record<string, string | string[] | undefined>
  body: string
  ip?: string
}

export type DavResult = {
  status: number
  headers: Record<string, string>
  body: string
}
