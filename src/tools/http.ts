import axios from 'axios'

export async function httpRequest(args: {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  body?: Record<string, unknown>
  headers?: Record<string, string>
}): Promise<string> {
  try {
    const res = await axios({ method: args.method ?? 'GET', url: args.url, data: args.body, headers: args.headers ?? {}, timeout: 15000 })
    return JSON.stringify(res.data, null, 2)
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}
