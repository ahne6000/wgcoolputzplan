import React, { useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import { useApi } from '../utils/api'

export default function CreateTask({ apiBase, embed=false }){
  const api = useApi(apiBase)
  const [users, setUsers] = useState([])
  const [form, setForm] = useState({
    title:'', description:'',
    task_type:'RECURRING_UNASSIGNED',
    interval_days:'', points:1,
    rotation_user_ids:[]
  })
  const [error, setError] = useState(null)
  const [okMsg, setOkMsg] = useState('')

  useEffect(()=>{ (async()=>{ try{ setUsers(await api.get('/ListAllUser')) }catch(e){ setError(e.message) } })() }, [apiBase])

  const onSubmit = async (e) => {
    e.preventDefault(); setError(null); setOkMsg('')
    const type = form.task_type

    const payload = {
      title: form.title.trim(),
      description: form.description?.trim() || null,
      task_type: type,
      points: Number(form.points) || 1,
      interval_days: (type==='ROTATING' || type==='RECURRING_UNASSIGNED')
        ? (form.interval_days ? Number(form.interval_days) : null)
        : null,
      rotation_user_ids: (type==='ROTATING' ? form.rotation_user_ids.map(Number) : null),
      // Neu: RECURRING_UNASSIGNED startet sofort (jetzt), sonst null
      first_due_at: (type==='RECURRING_UNASSIGNED')
        ? new Date().toISOString()
        : null,
    }

    try {
      const res = await api.post('/CreateTask', payload)
      setOkMsg(`Task #${res.id} angelegt`)
      setForm({
        title:'', description:'',
        task_type:'RECURRING_UNASSIGNED',
        interval_days:'', points:1,
        rotation_user_ids:[]
      })
    } catch(e){ setError(e.message) }
  }

  const type = form.task_type
  const toggleRotationUser = (id) => {
    setForm(f => {
      const idx = f.rotation_user_ids.indexOf(id)
      if (idx >= 0) {
        const arr = [...f.rotation_user_ids]; arr.splice(idx,1); return {...f, rotation_user_ids: arr}
      }
      return {...f, rotation_user_ids: [...f.rotation_user_ids, id]}
    })
  }

  const inner = (
    <>
      {error && <div className="mb-3 text-red-600">{String(error)}</div>}
      {okMsg && <div className="mb-3 text-emerald-700">{okMsg}</div>}

      <form onSubmit={onSubmit} className="grid md:grid-cols-2 gap-4">
        <div className="space-y-3">
          <input required value={form.title} onChange={(e)=>setForm({...form, title:e.target.value})} placeholder="Titel" className="w-full border rounded-lg px-3 py-2"/>
          <textarea value={form.description} onChange={(e)=>setForm({...form, description:e.target.value})} placeholder="Beschreibung (optional)" className="w-full border rounded-lg px-3 py-2"/>

          <div className="flex items-center gap-2">
            <label className="font-medium">Task-Typ:</label>
            <select value={type} onChange={(e)=>setForm({...form, task_type:e.target.value})} className="border rounded-lg px-3 py-2">
              <option value="ROTATING">ROTATING</option>
              <option value="RECURRING_UNASSIGNED">RECURRING_UNASSIGNED</option>
              <option value="ONE_OFF">ONE_OFF</option>
            </select>
          </div>

          {(type==='ROTATING' || type==='RECURRING_UNASSIGNED') && (
            <div className="flex items-center gap-2">
              <label className="font-medium w-40">Intervall (Tage)</label>
              <input type="number" value={form.interval_days} onChange={(e)=>setForm({...form, interval_days:e.target.value})} className="border rounded-lg px-3 py-2" placeholder="z. B. 7"/>
            </div>
          )}

          <div className="flex items-center gap-2">
            <label className="font-medium w-40">Punkte</label>
            <input type="number" value={form.points} onChange={(e)=>setForm({...form, points:e.target.value})} className="border rounded-lg px-3 py-2"/>
          </div>
        </div>

        <div className="space-y-3">
          {type==='ROTATING' && (
            <div>
              <div className="font-medium mb-1">Rotation – Reihenfolge (fix)</div>
              <div className="flex flex-wrap gap-2">
                {users.map(u => {
                  const active = form.rotation_user_ids.includes(u.id)
                  return (
                    <button
                      type="button"
                      key={u.id}
                      onClick={()=>toggleRotationUser(u.id)}
                      className={`px-3 py-1 rounded-full border ${active?'bg-gray-900 text-white':'bg-white'}`}
                    >
                      {u.name}
                    </button>
                  )
                })}
              </div>
              <div className="mt-2 text-sm">Reihenfolge: {form.rotation_user_ids.map(id=>users.find(u=>u.id===id)?.name||id).join(' → ') || '—'}</div>
            </div>
          )}

          {type==='RECURRING_UNASSIGNED' && (
            <div className="text-sm text-gray-600">
              Start: <span className="font-medium">sofort (Zeitpunkt des Anlegens)</span>. Nach Abschluss wird jeweils + Intervall neu geplant.
            </div>
          )}

          {type==='ONE_OFF' && (
            <div className="text-sm text-gray-600">
              Einmalige Aufgabe – keine Restlaufzeit / Fälligkeit.
            </div>
          )}
        </div>

        <div className="md:col-span-2">
          <button type="submit" className="px-4 py-2 rounded-lg bg-gray-900 text-white">Task anlegen</button>
        </div>
      </form>
    </>
  )

  if (embed) return inner
  return <PageShell title="Task anlegen">{inner}</PageShell>
}
