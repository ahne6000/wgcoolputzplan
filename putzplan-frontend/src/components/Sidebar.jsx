import React, { useEffect, useState } from 'react'
import Avatar from './Avatar'
import { useApi } from '../utils/api'
import { navTo } from '../utils/router'

export default function Sidebar({ current, apiBase, open=false, setOpen }){
  const api = useApi(apiBase)
  const [users, setUsers] = useState([])
  useEffect(()=>{ (async()=>{ try{ setUsers(await api.get('/ListAllUser')) }catch(e){} })() }, [apiBase])

  const top = [
    { key: 'tasks', label: 'Übersicht', icon: '🏠' },
    { key: 'boerse',     label: 'Handel', icon: '🪙'},
    { key: 'settings', label: 'Settings', icon: '⚙️' },

  ]

  const go = (key, params) => {
    navTo(key, params)
    if (setOpen) setOpen(false) // Drawer schließen auf Mobile
  }

  return (
    <>
      {/* Overlay bei offenem Drawer */}
      <div
        className={`fixed inset-0 z-30 bg-black/40 md:hidden transition-opacity ${open ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}
        onClick={()=>setOpen && setOpen(false)}
      />
      <aside
        className={
          `fixed top-0 left-0 z-40 h-full w-64 bg-gray-900 text-gray-100 p-4 flex flex-col gap-3
           transform transition-transform md:translate-x-0
           ${open ? 'translate-x-0' : '-translate-x-full'}`
        }
      >
        <div className="flex items-center justify-between">
          <div className="text-xl font-semibold">🧹 Putzplan</div>
          <button className="p-2 rounded hover:bg-gray-800 md:hidden" onClick={()=>setOpen && setOpen(false)} aria-label="Menü schließen">✕</button>
        </div>

        {top.map(it => (
          <button
            key={it.key}
            onClick={()=>go(it.key)}
            className={`text-left px-3 py-2 rounded-lg flex items-center gap-2 ${current===it.key?'bg-gray-700':'hover:bg-gray-800'}`}
          >
            <span className="text-lg">{it.icon}</span>
            <span className="hidden md:inline">{it.label}</span>
            <span className="md:hidden sr-only">{it.label}</span>
          </button>
        ))}

        <div className="text-xs uppercase tracking-wider text-gray-400 mt-2">Users</div>
        <div className="flex flex-col gap-1">
          {users.map(u => {
            const src = u.profile_picture_url ? (apiBase + u.profile_picture_url) : null
            const active = current === `user:${u.id}`
            return (
              <button
                key={u.id}
                onClick={()=>go('user',{id:u.id})}
                className={`w-full flex items-center gap-2 px-2 py-2 rounded-lg text-left ${active?'bg-gray-700':'hover:bg-gray-800'}`}
              >
                <Avatar src={src} name={u.name} size={24}/>
                <span className="truncate">{u.name}</span>
                <span className="ml-auto text-xs text-gray-400">{u.credits}</span>
              </button>
            )
          })}
        </div>

        <div className="mt-auto text-xs text-gray-400">Frontend v0.4</div>
      </aside>
    </>
  )
}
