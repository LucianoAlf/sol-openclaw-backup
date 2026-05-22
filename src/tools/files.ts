import * as fs from 'fs'
import * as path from 'path'

function safePath(workspacePath: string, filePath: string): string | null {
  const resolved = path.resolve(workspacePath, filePath)
  const base = path.resolve(workspacePath)
  if (!resolved.startsWith(base)) return null
  return resolved
}

export async function readFile(workspacePath: string, args: { path: string }): Promise<string> {
  const resolved = safePath(workspacePath, args.path)
  if (!resolved) return 'Error: path traversal not allowed'
  try {
    return fs.readFileSync(resolved, 'utf-8')
  } catch {
    return `Error: file not found — ${args.path}`
  }
}

export async function writeFile(workspacePath: string, args: { path: string; content: string }): Promise<string> {
  const resolved = safePath(workspacePath, args.path)
  if (!resolved) return 'Error: path traversal not allowed'
  const dir = path.dirname(resolved)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(resolved, args.content, 'utf-8')
  return `ok: wrote ${args.path}`
}

export async function listFiles(workspacePath: string, args: { path: string }): Promise<string> {
  const resolved = safePath(workspacePath, args.path)
  if (!resolved) return 'Error: path traversal not allowed'
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true })
    return entries.map(e => `${e.isDirectory() ? '[dir] ' : ''}${e.name}`).join('\n')
  } catch {
    return `Error: cannot list ${args.path}`
  }
}
