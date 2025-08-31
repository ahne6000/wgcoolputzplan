import React, { useEffect, useMemo, useState } from 'react'
import Avatar from './Avatar'
import { useApi } from '../utils/api'

export default function CookingMiniPanel({ apiBase, cookerUserId }) {
  const api = useApi(apiBase)
  const [users, setUsers] = useState([])
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  // Form
  const [title, setTitle] = useState('')
  const [cookedAtLocal, setCookedAtLocal] = useState('')
  const [credits, setCredits] = useState('')
  const [eaters, setEaters] = useState({}) // id -> bool
  const [open, setOpen] = useState(false)

  const load = async () => {
    try{
      setLoading(true)
      const [u, ev] = await Promise.all([
        api.get('/ListAllUser'),
        api.get('/ListCookingEvents?limit=200'),
      ])
      setUsers(u || [])
      setEvents((ev || []).filter(e => e.cooker_user_id === Number(cookerUserId)))
    }catch(e){ setError(e.message) } finally { setLoading(false) }
  }
  useEffect(()=>{ load() }, [apiBase, cookerUserId])

  const eaterIds = useMemo(
    () => Object.entries(eaters).filter(([,v])=>v).map(([k])=>Number(k)),
    [eaters]
  )

  const submit = async () => {
    if (!cookerUserId) return alert('Kein Koch ausgewählt.')
    setBusy(true)
    const fd = new FormData()
    fd.append('cooker_user_id', String(cookerUserId))
    eaterIds.forEach(id => fd.append('eater_user_ids', String(id)))
    if (title) fd.append('title', title.trim())
    if (credits) fd.append('credits', String(credits))
    if (cookedAtLocal) {
      const iso = new Date(cookedAtLocal).toISOString()
      fd.append('cooked_at', iso)
    }
    const res = await fetch(apiBase + '/CookAdd', { method:'POST', body: fd })
    setBusy(false)
    if (res.ok){
      setTitle(''); setCredits(''); setCookedAtLocal(''); setEaters({})
      await load()
    } else {
      alert('Anlegen fehlgeschlagen: ' + await res.text())
    }
  }

  const delEvent = async (id) => {
    if (!confirm('Eintrag löschen? Credits werden zurückgenommen.')) return
    const fd = new FormData(); fd.append('event_id', String(id))
    const res = await fetch(apiBase + '/DeleteCookingEvent', { method:'POST', body: fd })
    if (res.ok) await load()
    else alert('Löschen fehlgeschlagen: ' + await res.text())
  }

  const me = users.find(u => u.id === Number(cookerUserId))
  const avatarOf = (id) => {
    const u = users.find(x=>x.id===id)
    return u?.profile_picture_url ? (apiBase + u.profile_picture_url) : null
  }

  const totalCredits = (events || []).reduce((s,e)=> s + (e.credits_awarded||0), 0)

  return (
    <div className="rounded-2xl border bg-white">
      <div className="p-3 flex items-center justify-between border-b">
        <div className="font-semibold">Kochen – Einträge von {me?.name || `#${cookerUserId}`}</div>
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-600">Summe: <span className="font-medium">+{totalCredits}</span> Cr</div>
          <button onClick={()=>setOpen(o=>!o)} className="px-3 py-2 rounded-lg bg-indigo-600 text-white">
            {open ? 'Formular schließen' : 'Eintrag anlegen'}
          </button>
          <button onClick={load} className="px-3 py-2 rounded-lg bg-gray-900 text-white">{loading?'Lädt…':'Neu laden'}</button>
        </div>
      </div>

      {error && <div className="px-3 py-2 text-rose-600">{String(error)}</div>}

      {open && (
        <div className="p-4 border-b">
          <div className="grid md:grid-cols-4 gap-4">
            <div>
              <div className="text-sm text-gray-600 mb-1">Was wurde gekocht? (optional)</div>
              <input className="w-full border rounded-lg px-2 py-2" placeholder="z. B. Chili sin Carne" value={title} onChange={e=>setTitle(e.target.value)} />
            </div>
            <div>
              <div className="text-sm text-gray-600 mb-1">Wann? (optional)</div>
              <input type="datetime-local" className="w-full border rounded-lg px-2 py-2" value={cookedAtLocal} onChange={e=>setCookedAtLocal(e.target.value)} />
            </div>
            <div>
              <div className="text-sm text-gray-600 mb-1">Credits (optional)</div>
              <input type="number" className="w-full border rounded-lg px-2 py-2" placeholder="auto: 2 pro Mitesser" value={credits} onChange={e=>setCredits(e.target.value)} />
            </div>
            <div>
              <div className="text-sm text-gray-600 mb-1">Mitesser</div>
              <div className="flex flex-wrap gap-2">
                {users.filter(u=>u.id!==Number(cookerUserId)).map(u=>{
                  const checked = !!eaters[u.id]
                  return (
                    <label key={u.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer ${checked?'bg-emerald-50 border-emerald-400':'bg-white'}`}>
                      <input type="checkbox" checked={checked} onChange={(e)=>setEaters(prev=>({...prev, [u.id]: e.target.checked}))} />
                      <Avatar size={20} src={avatarOf(u.id)} name={u.name} />
                      <span className="text-sm">{u.name}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          </div>
          <div className="mt-4">
            <button onClick={submit} disabled={busy} className="px-4 py-2 rounded-lg bg-indigo-600 text-white">
              {busy ? 'Speichere…' : 'Eintrag anlegen'}
            </button>
          </div>
        </div>
      )}

      {/* Liste */}
      <ul className="divide-y">
        {events.length === 0 ? (
          <li className="p-4 text-gray-600">Noch keine Einträge.</li>
        ) : events.map(ev => (
          <li key={ev.id} className="p-3 flex items-center gap-3">
            <Avatar size={36} src={avatarOf(ev.cooker_user_id)} name={me?.name || `#${ev.cooker_user_id}`} />
            <div className="flex-1 min-w-0">
              <div className="font-medium">
                {me?.name || `#${ev.cooker_user_id}`}{' '}
                {ev.title ? <>hat <span className="font-semibold">{ev.title}</span> gekocht</> : 'hat gekocht'}
              </div>
              <div className="text-xs text-gray-600">
                {new Date(ev.cooked_at).toLocaleString()} · Mitesser: {ev.eater_user_ids?.length || 0}
              </div>
              {ev.eater_user_ids?.length ? (
                <div className="mt-1 flex -space-x-2">
                  {ev.eater_user_ids.map(uid => (
                    <div key={uid} className="inline-block border-2 border-white rounded-full overflow-hidden w-7 h-7">
                      <Avatar size={28} src={avatarOf(uid)} name={(users.find(x=>x.id===uid)||{}).name || `#${uid}`} />
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div className="text-sm text-gray-700 mr-3">+{ev.credits_awarded} Cr</div>
            <button onClick={()=>delEvent(ev.id)} className="px-2 py-1 rounded bg-red-600 text-white">Löschen</button>
          </li>
        ))}
      </ul>
    </div>
  )
}
