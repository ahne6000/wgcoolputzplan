import React from 'react'
import { navTo } from '../utils/router'

export default function Header({ onMenu }){
  return (
    <header className="fixed top-0 left-0 right-0 z-30 h-14 bg-white/90 backdrop-blur border-b flex items-center px-3 md:hidden">
      <button aria-label="Menü öffnen" onClick={onMenu} className="p-2 rounded hover:bg-gray-100">☰</button>
      <div className="mx-3 font-semibold">Putzplan</div>
      <div className="ml-auto flex items-center gap-1">
        <button onClick={()=>navTo('tasks')} className="p-2 rounded hover:bg-gray-100" aria-label="Übersicht">🏠</button>
        <button onClick={()=>navTo('settings')} className="p-2 rounded hover:bg-gray-100" aria-label="Settings">⚙️</button>
      </div>
    </header>
  )
}
