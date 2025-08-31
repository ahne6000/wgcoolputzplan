import React, { useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import Avatar from '../components/Avatar'
import { useApi } from '../utils/api'

export default function Kochen({ apiBase }){
  const api = useApi(apiBase)
  const [users, setUsers] = useState([])
  const [events, setEvents] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  // Form state
  const [cookerId, setCookerId] = useState(null)
  const [title, setTitle] = useState('')
  const [cookedAtLocal, setCookedAtLocal] = useState('') // datetime-local (optional)
  const [credits, setCredits] = useState('') // optional override
  const [eaters, setEaters] = useState({}) // id -> bool

  const load = async () => {
    try{
      setLoading(true)
      const [u, ev] = await Promise.all([
        api.get('/ListAllUser'),
        api.get('/ListCookingEvents?limit=50'),
      ])
      setUsers(u||[])
      setEvents(ev||[])
      if (!cookerId && u?.length) setCookerId(u[0].id)
    }catch(e){ setError(e.message) } finally { setLoading(false) }
  }
  useEffect(()=>{ load() }, [apiBase])

  const eaterIds = Object.entries(eaters).filter(([,v])=>v).map(([k])=>Number(k))

  const submit = async () => {
    if (!cookerId) return alert('Bitte „Wer hat gekocht“ wählen.')
    setBusy(true)
    const fd = new FormData()
    fd.append('cooker_user_id', String(cookerId))
    eaterIds.forEach(id => fd.append('eater_user_ids', String(id)))
    if (title) fd.append('title', title.trim())
    if (credits) fd.append('credits', String(credits))
    if (cookedAtLocal){
      // HTML datetime-local ist lokal ohne TZ – wir wandeln nach ISO UTC
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
    const res = await fetch(apiBase + '/DeleteCookingEvent', { method: 'POST', body: fd })
    if (res.ok) await load()
    else alert('Löschen fehlgeschlagen: ' + await res.text())
  }

  const userById = (id) => users.find(u=>u.id===id)
  const nameById = (id) => userById(id)?.name || `#${id}`
  const avatarOf  = (id) => {
    const u = userById(id)
    return u?.profile_picture_url ? (apiBase + u.profile_picture_url) : null
  }

  return (
    <PageShell
      title="Kochen"
      right={<button onClick={load} className="px-3 py-2 rounded-lg bg-gray-900 text-white">{loading?'Lädt…':'Neu laden'}</button>}
    >
      {error && <div className="mb-3 text-red-600">{String(error)}</div>}

      {/* Formular */}
      <div className="rounded-2xl border bg-white p-4 mb-6">
        <div className="grid md:grid-cols-4 gap-4">
          <div>
            <div className="text-sm text-gray-600 mb-1">Wer hat gekocht?</div>
            <select className="w-full border rounded-lg px-2 py-2" value={cookerId??''} onChange={e=>setCookerId(Number(e.target.value)||null)}>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Was wurde gekocht? (optional)</div>
            <input className="w-full border rounded-lg px-2 py-2" placeholder="z. B. Pasta mit Pesto" value={title} onChange={e=>setTitle(e.target.value)} />
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Wann? (optional)</div>
            <input type="datetime-local" className="w-full border rounded-lg px-2 py-2" value={cookedAtLocal} onChange={e=>setCookedAtLocal(e.target.value)} />
          </div>
          <div>
            <div className="text-sm text-gray-600 mb-1">Credits (optional)</div>
            <input type="number" className="w-full border rounded-lg px-2 py-2" placeholder="auto: 2 pro Mitesser" value={credits} onChange={e=>setCredits(e.target.value)} />
          </div>
        </div>

        <div className="mt-4">
          <div className="text-sm text-gray-600 mb-1">Wer hat mitgegessen?</div>
          <div className="flex flex-wrap gap-2">
            {users.map(u=>{
              const checked = !!eaters[u.id]
              return (
                <label key={u.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border cursor-pointer ${checked?'bg-emerald-50 border-emerald-400':'bg-white'}`}>
                  <input type="checkbox" checked={checked} onChange={(e)=>setEaters(prev=>({...prev, [u.id]: e.target.checked}))} />
                  <Avatar size={24} src={u.profile_picture_url ? (apiBase + u.profile_picture_url) : null} name={u.name} />
                  <span>{u.name}</span>
                </label>
              )
            })}
          </div>
        </div>

        <div className="mt-4">
          <button onClick={submit} disabled={busy || !cookerId} className="px-4 py-2 rounded-lg bg-indigo-600 text-white">
            {busy ? 'Speichere…' : 'Eintrag anlegen'}
          </button>
        </div>
      </div>

      {/* Liste der letzten Einträge */}
      <div className="rounded-2xl border bg-white">
        <div className="p-3 border-b font-semibold">Letzte Einträge</div>
        {events.length === 0 ? (
          <div className="p-4 text-gray-600">Noch keine Einträge.</div>
        ) : (
          <ul className="divide-y">
            {events.map(ev => (
              <li key={ev.id} className="p-3 flex items-center gap-3">
                <Avatar size={36} src={avatarOf(ev.cooker_user_id)} name={nameById(ev.cooker_user_id)} />
                <div className="flex-1 min-w-0">
                  <div className="font-medium">
                    {nameById(ev.cooker_user_id)}{' '}
                    {ev.title ? <>hat <span className="font-semibold">{ev.title}</span> gekocht</> : 'hat gekocht'}
                  </div>
                  <div className="text-xs text-gray-600">
                    {new Date(ev.cooked_at).toLocaleString()} · Mitesser: {ev.eater_user_ids?.length || 0}
                  </div>
                  {ev.eater_user_ids?.length ? (
                    <div className="mt-1 flex -space-x-2">
                      {ev.eater_user_ids.map(uid => (
                        <div key={uid} className="inline-block border-2 border-white rounded-full overflow-hidden w-7 h-7">
                          <Avatar size={28} src={avatarOf(uid)} name={nameById(uid)} />
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
        )}
      </div>
    </PageShell>
  )
}
