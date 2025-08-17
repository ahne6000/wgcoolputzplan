// Simple hash-router with named exports.
// Supports: tasks (default), settings, user/:id, task/:id, boerse

export function parseRoute() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '')
  const segs = raw.split('/').filter(Boolean)
  const name = segs[0] || 'tasks'
  const id = segs[1]

  if (name === 'user' && id)   return { name: 'user', params: { id: Number(id) } }
  if (name === 'task' && id)   return { name: 'task', params: { id: Number(id) } }
  if (name === 'settings')     return { name: 'settings', params: {} }
  if (name === 'boerse')       return { name: 'boerse', params: {} }
  if (name === 'tasks')        return { name: 'tasks', params: {} }

  // unknown → fallback
  return { name: 'tasks', params: {} }
}

export function navTo(name, params = {}) {
  if (name === 'user')      window.location.hash = `#/user/${params.id}`
  else if (name === 'task') window.location.hash = `#/task/${params.id}`
  else if (name === 'settings') window.location.hash = '#/settings'
  else if (name === 'boerse')   window.location.hash = '#/boerse'
  else window.location.hash = '#/tasks'
}

// ensure we always have a hash on initial load
export function ensureInitialHash() {
  if (!window.location.hash) {
    window.location.hash = '#/tasks'
  }
}
