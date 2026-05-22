import { createClient } from '@supabase/supabase-js'

type ProjectKey = 'main' | 'studio' | 'folha' | 'workshops'

interface ExtraProjects {
  studio?: string
  folha?: string
  workshops?: string
  extraServiceKey?: string
}

const BLOCKED_KEYWORDS = ['delete', 'drop', 'truncate', 'update', 'insert', 'alter', 'create']

function isReadOnly(query: string): boolean {
  const q = query.trim().toLowerCase()
  return q.startsWith('select') || q.startsWith('with')
}

export function createSupabaseTool(mainUrl: string, mainKey: string, extra: ExtraProjects) {
  const supabaseMain = createClient(mainUrl, mainKey)

  return async (args: { query: string; project?: string }): Promise<string> => {
    const project = (args.project ?? 'main') as ProjectKey

    if (!isReadOnly(args.query)) {
      return 'Error: apenas SELECT é permitido.'
    }

    const blocked = BLOCKED_KEYWORDS.find(k => args.query.toLowerCase().includes(k))
    if (blocked) return `Error: query bloqueada — contém "${blocked}"`

    if (project !== 'main') {
      return `Error: projeto "${project}" não suportado ainda. Use "main".`
    }

    try {
      const { data, error } = await supabaseMain.rpc('exec_sql', { sql: args.query })
      if (error) return `Error: ${error.message}`
      return JSON.stringify(data, null, 2)
    } catch (e: any) {
      return `Error: ${e.message}`
    }
  }
}
