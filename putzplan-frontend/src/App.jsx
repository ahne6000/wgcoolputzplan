import React, { useEffect, useState } from 'react'
import Sidebar from './components/Sidebar'
import Header from './components/Header'
import Users from './pages/Users'
import CreateTask from './pages/CreateTask'
import TasksOverview from './pages/TasksOverview'
import Logs from './pages/Logs'
import Settings from './pages/Settings'
import UserDetail from './pages/UserDetail'
import TaskDetail from './pages/TaskDetail'
import { parseRoute, ensureInitialHash } from './utils/router'
import { getDefaultApiBase } from './utils/api'
import Boerse from './pages/Boerse.jsx'

export default function App(){
  const [route, setRoute] = useState(parseRoute())
  const [apiBase, setApiBase] = useState(getDefaultApiBase())
  const [sidebarOpen, setSidebarOpen] = useState(false)

  useEffect(()=>{
    ensureInitialHash()                    // 👈 sorgt für #/tasks beim ersten Load
    const onHash = () => setRoute(parseRoute())
    window.addEventListener('hashchange', onHash)
    // einmal direkt auslesen (falls ensureInitialHash gerade gesetzt hat)
    setRoute(parseRoute())
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  useEffect(()=>{ setSidebarOpen(false) }, [route])

  let page = null
  const name = route.name
  if(name==='users') page = <Users apiBase={apiBase} />
  else if(name==='createTask') page = <CreateTask apiBase={apiBase} />
  else if(name==='logs') page = <Logs apiBase={apiBase} />
  else if(name==='settings') page = <Settings apiBase={apiBase} setApiBase={setApiBase} />
  else if(name==='task') page = <TaskDetail apiBase={apiBase} taskId={route.params.id} />
  else if(name==='user') page = <UserDetail apiBase={apiBase} userId={route.params.id} />
  else if(name==='boerse') page = <Boerse apiBase={apiBase} />
  else page = <TasksOverview apiBase={apiBase} />

  const currentKey = name==='user' ? `user:${route.params.id}` : (name==='task' ? 'tasks' : name)

  return (
    <div className="min-h-screen">
      <Header onMenu={()=>setSidebarOpen(true)} />
      <Sidebar current={currentKey} apiBase={apiBase} open={sidebarOpen} setOpen={setSidebarOpen} />
      {page}
    </div>
  )
}
