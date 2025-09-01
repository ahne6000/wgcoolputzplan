import React, { useEffect, useState } from 'react'
import { undoStore, hideUndo } from '../utils/undo'

export default function UndoToast({ apiBase }){
  const [st, setSt] = useState({ visible:false, message:'', deadline:0 })
  const [tick, setTick] = useState(0)       // damit der Countdown sichtbar „tickt“
  const [busy, setBusy] = useState(false)

  useEffect(()=> {
    const unsub = undoStore.subscribe(setSt)
    const id = setInterval(()=> setTick(t => t+1), 1000)
    return () => { unsub(); clearInterval(id) }
  }, [])

  if (!st.visible) return null
  const secondsLeft = Math.max(0, Math.ceil((st.deadline - Date.now())/1000))

  const onUndo = async () => {
    if (busy) return
    setBusy(true)
    try{
      const res = await fetch(`${apiBase}/UndoLastRecent?window_sec=60`, { method:'POST' })
      if (!res.ok) {
        try { alert(await res.text()) } catch {}
      }
      // Egal ob ok oder nicht: Toast schließen & Seite sicher aktualisieren
      hideUndo()
      window.location.reload()
    } catch {
      hideUndo()
      window.location.reload()
    }
  }

  return (
    <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50">
      <div className="flex items-center gap-3 rounded-xl bg-gray-900 text-white px-4 py-3 shadow-lg">
        <span className="text-sm">{st.message}</span>
        <span className="text-xs opacity-75">({secondsLeft}s)</span>
        <button
          onClick={onUndo}
          disabled={busy}
          className={`px-3 py-1 rounded text-sm ${busy ? 'bg-gray-700' : 'bg-emerald-600'}`}
        >
          {busy ? 'Bitte warten…' : 'Rückgängig'}
        </button>
        <button onClick={hideUndo} className="px-3 py-1 rounded bg-gray-700 text-white text-sm">Schließen</button>
      </div>
    </div>
  )
}
