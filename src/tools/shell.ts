import { execSync } from 'child_process'

const BLOCKLIST = [
  'rm -rf', 'rm -f', 'sudo', 'chmod', 'chown',
  'mkfs', 'dd if=', 'shutdown', 'reboot', 'halt',
  '> /dev/', 'wget http', 'curl -O', 'passwd',
  'userdel', 'usermod', ':(){ :|:& };:'
]

export async function executeShell(args: { command: string }): Promise<string> {
  const cmd = args.command.toLowerCase()
  const blocked = BLOCKLIST.find(b => cmd.includes(b))
  if (blocked) return `Error: command blocked — contains "${blocked}"`

  try {
    const output = execSync(args.command, { timeout: 10000, encoding: 'utf-8', shell: '/bin/sh' })
    return output || '(no output)'
  } catch (e: any) {
    return `Error: ${e.message}`
  }
}
