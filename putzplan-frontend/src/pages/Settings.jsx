import React, { useState } from 'react'
import PageShell from '../components/PageShell'
import Users from './Users'
import CreateTask from './CreateTask'
import Logs from './Logs'
import ManageTasks from './ManageTasks'

export default function Settings({ apiBase, setApiBase }){
  const [tab, setTab] = useState('general')
  const [tmp, setTmp] = useState(apiBase)

  const TabBtn = ({id, children}) => (
    <button
      onClick={()=>setTab(id)}
      className={`px-3 py-2 rounded-lg text-sm ${tab===id?'bg-gray-900 text-white':'bg-gray-100 hover:bg-gray-200'}`}
    >{children}</button>
  )

  return (
    <PageShell title="Settings">
      <div className="flex flex-wrap gap-2 mb-4">
        <TabBtn id="general">General</TabBtn>
        <TabBtn id="users">Users</TabBtn>
        <TabBtn id="create">Task anlegen</TabBtn>
        <TabBtn id="manage">Tasks verwalten</TabBtn>
        <TabBtn id="logs">Logs</TabBtn>
      </div>

      {tab==='general' && (
        <div className="space-y-3 max-w-xl">
          <div className="text-sm text-gray-600">API Base URL. Bei Vite-Proxy /api belassen, sonst direkt auf http://127.0.0.1:8000 stellen.</div>
          <input value={tmp} onChange={(e)=>setTmp(e.target.value)} className="w-full border rounded-lg px-3 py-2"/>
          <button onClick={()=>setApiBase(tmp)} className="px-3 py-2 rounded-lg bg-gray-900 text-white">Speichern</button>
          <div className="text-xs text-gray-500">Aktuell: {apiBase||'(root)'}</div>
        </div>
      )}

      {tab==='users' && <Users apiBase={apiBase} embed />}

      {tab==='create' && <CreateTask apiBase={apiBase} embed />}

      {tab==='manage' && <ManageTasks apiBase={apiBase} />}

      {tab==='logs' && <Logs apiBase={apiBase} embed />}
    </PageShell>
  )
}
