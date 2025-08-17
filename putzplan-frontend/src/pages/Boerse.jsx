import React, { useEffect, useMemo, useState } from 'react'
import PageShell from '../components/PageShell'
import Avatar from '../components/Avatar'
import { useApi } from '../utils/api'
import { daysLeft } from '../utils/due.jsx'

export default function Boerse({ apiBase }){
  const api = useApi(apiBase)
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = async () => {
    try{
      const [t,u,a] = await Promise.all([
        api.get('/ListAllTasks'),
        api.get('/ListAllUser'),
        api.get('/ListAssignments'),
      ])
      setTasks(t||[]); setUsers(u||[]); setAssignments(a||[])
    }catch(e){ setError(e.message) }
  }
  useEffect(()=>{ load() }, [apiBase])

  const nameById = (id) => users.find(u=>u.id===id)?.name || (id ? `#${id}` : '—')
  const avatarById = (id) => {
    const u = users.find(x=>x.id===id)
    return u?.profile_picture_url ? (apiBase + u.profile_picture_url) : null
  }

  // Pending-Assigned je Task
  const pendingAssignedByTask = useMemo(()=>{
    const m = new Map()
    assignments.forEach(a => { if(a.status==='PENDING' && a.user_id!=null && !m.has(a.task_id)) m.set(a.task_id, a) })
    return m
  }, [assignments])

  const rotating = tasks.filter(t => t.task_type === 'ROTATING')

  const [selPartner, setSelPartner] = useState({}) // taskId -> partnerId
  const [swapA, setSwapA] = useState({})
  const [swapB, setSwapB] = useState({})

  const doCover = async (taskId) => {
    const partnerId = selPartner[taskId]
    if(!partnerId) return
    setBusy(true)
    const fd = new FormData()
    fd.append('task_id', String(taskId))
    fd.append('cover_user_id', String(partnerId))
    const res = await fetch(apiBase + '/SwapCover', { method:'POST', body: fd })
    setBusy(false)
    if(res.ok) await load()
    else alert('Cover fehlgeschlagen: ' + await res.text())
  }

  const doSwapOrder = async (taskId) => {
  const a = swapA[taskId], b = swapB[taskId]
  if(!a || !b || a===b) return
  setBusy(true)
  const fd = new FormData()
  fd.append('task_id', String(taskId))
  fd.append('user_a_id', String(a))
  fd.append('user_b_id', String(b))
  const res = await fetch(apiBase + '/SwapRotationOrderOneCycle', { method:'POST', body: fd })
  setBusy(false)
  if(res.ok) await load()
  else alert('Swap (1 Zyklus) fehlgeschlagen: ' + await res.text())
}


  return (
    <PageShell
      title="Börse – Tauschen & Vertreten"
      right={<button onClick={load} className="px-3 py-2 rounded-lg bg-gray-900 text-white">{busy?'...':'Neu laden'}</button>}
    >
      {error && <div className="mb-3 text-red-600">{String(error)}</div>}

      {rotating.length===0 ? (
        <div className="text-gray-600">Keine rotierenden Tasks gefunden.</div>
      ) : (
        <div className="space-y-4">
          {rotating.map(t => {
            const pa = pendingAssignedByTask.get(t.id)
            const currentId = pa?.user_id ?? t.next_assignee_user_id ?? null
            const partnerOptions = (t.rotation_user_ids||[]).filter(id => id !== currentId)

            return (
              <div key={t.id} className="rounded-2xl border bg-white">
                <div className="p-4 border-b flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{t.title} <span className="text-xs text-gray-500">#{t.id}</span></div>
                    <div className="text-sm text-gray-600">
                      Rotation: {t.rotation_user_ids?.map(id=>nameById(id)).join(' → ') || '—'}
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    Intervall: <span className="font-medium">{t.interval_days ?? '—'}</span> Tage
                  </div>
                </div>

                {/* Zeile 1: Vertretung (Skip später) */}
                <div className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
                  <div className="text-sm w-56">
                    <div className="font-medium mb-1">Vertretung (mit Ausgleich)</div>
                    <div>Jemand übernimmt HEUTE. Der Übernehmer erhält 1× Skip beim nächsten eigenen Turn.</div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-sm text-gray-500">Aktuell dran:</div>
                    <div className="flex items-center gap-2">
                      <Avatar size={32} src={avatarById(currentId)} name={nameById(currentId)} />
                      <div className="font-medium">{nameById(currentId)}</div>
                    </div>
                    <div className="text-sm text-gray-500 mx-2">→</div>
                    <select
                      className="border rounded-lg px-2 py-1"
                      value={selPartner[t.id] || ''}
                      onChange={e => setSelPartner(s => ({...s, [t.id]: Number(e.target.value)||null}))}
                    >
                      <option value="">Partner wählen…</option>
                      {partnerOptions.map(uid => <option key={uid} value={uid}>{nameById(uid)}</option>)}
                    </select>
                    <button onClick={()=>doCover(t.id)} className="px-3 py-2 rounded-lg bg-indigo-600 text-white disabled:opacity-50" disabled={!selPartner[t.id]}>
                      Vertreten lassen
                    </button>
                  </div>
                </div>

                <div className="border-t" />

                {/* Zeile 2: Plätze tauschen (permanent) */}
                <div className="p-4 flex flex-col gap-3 md:flex-row md:items-center md:gap-6">
                  <div className="text-sm w-56">
                    <div className="font-medium mb-1">Plätze tauschen (1 Zyklus)</div>
                    <div>Die Positionen in der Rotation werden temporär vertauscht.</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      className="border rounded-lg px-2 py-1"
                      value={swapA[t.id] || ''}
                      onChange={e => setSwapA(s => ({...s, [t.id]: Number(e.target.value)||null}))}
                    >
                      <option value="">User A wählen…</option>
                      {(t.rotation_user_ids||[]).map(uid => <option key={uid} value={uid}>{nameById(uid)}</option>)}
                    </select>
                    <div className="text-sm text-gray-500">↔</div>
                    <select
                      className="border rounded-lg px-2 py-1"
                      value={swapB[t.id] || ''}
                      onChange={e => setSwapB(s => ({...s, [t.id]: Number(e.target.value)||null}))}
                    >
                      <option value="">User B wählen…</option>
                      {(t.rotation_user_ids||[]).map(uid => <option key={uid} value={uid}>{nameById(uid)}</option>)}
                    </select>
                    <button onClick={()=>doSwapOrder(t.id)} className="px-3 py-2 rounded-lg bg-emerald-600 text-white disabled:opacity-50" disabled={!swapA[t.id] || !swapB[t.id] || swapA[t.id]===swapB[t.id]}>
                      Plätze tauschen
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </PageShell>
  )
}
