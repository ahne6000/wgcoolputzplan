export function parseRoute(){
  const hash = window.location.hash || '#/tasks'
  const parts = hash.replace(/^#\//,'').split('/')
  if(parts[0]==='user' && parts[1]) return { name:'user', params:{ id: parts[1] } }
  if(parts[0]==='task' && parts[1]) return { name:'task', params:{ id: parts[1] } }
  const nameMap = { 'tasks':'tasks', 'users':'users', 'create':'createTask', 'logs':'logs', 'settings':'settings' }
  const name = nameMap[parts[0]] || 'tasks'
  return { name, params:{} }
}
export function navTo(name, params={}){
  if(name==='user') window.location.hash = `#/user/${params.id}`
  else if(name==='task') window.location.hash = `#/task/${params.id}`
  else if(name==='tasks') window.location.hash = '#/tasks'
  else if(name==='users') window.location.hash = '#/users'
  else if(name==='createTask') window.location.hash = '#/create'
  else if(name==='logs') window.location.hash = '#/logs'
  else if(name==='settings') window.location.hash = '#/settings'
  else window.location.hash = '#/tasks'
}
