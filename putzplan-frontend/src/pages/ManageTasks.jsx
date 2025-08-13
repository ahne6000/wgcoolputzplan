import React, { useEffect, useMemo, useState } from 'react'
import { useApi } from '../utils/api'

export default function ManageTasks({ apiBase }){
  const api = useApi(apiBase)
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [error, setError] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try{
      const [t,u,a] = await Promise.all([
        api.get('/ListAllTasks'),
        api.get('/ListAllUser'),
        api.get('/ListAssignments')
      ])
      setTasks(t||[]); setUsers(u||[]); setAssignments(a||[])
    }catch(e){ setError(e.message) }
  }
  useEffect(()=>{ load() }, [apiBase])

  const nameById = (id) => users.find(u=>u.id===id)?.name || (id ? `#${id}` : '—')

  // Rotation Helpers
  const moveInArray = (arr, from, to) => {
    const a = [...arr]
    const item = a.splice(from,1)[0]
    a.splice(to,0,item)
    return a
  }

  const onRotationMove = (taskId, idx, dir) => {
    setTasks(ts => ts.map(t => {
      if (t.id!==taskId) return t
      const arr = Array.isArray(t.rotation_order_user_ids) ? t.rotation_order_user_ids : []
      const to = Math.min(arr.length-1, Math.max(0, idx+dir))
      return { ...t, rotation_order_user_ids: moveInArray(arr, idx, to) }
    }))
  }

  const onRotationRemove = (taskId, userId) => {
    setTasks(ts => ts.map(t => {
      if (t.id!==taskId) return t
      const arr = (t.rotation_order_user_ids||[]).filter(id => id!==userId)
      return { ...t, rotation_order_user_ids: arr }
    }))
  }

  const onRotationAdd = (taskId, userId) => {
    setTasks(ts => ts.map(t => {
      if (t.id!==taskId) return t
      const arr = [...(t.rotation_order_user_ids||[]), userId]
      return { ...t, rotation_order_user_ids: arr }
    }))
  }

  const saveRotation = async (task) => {
    setSaving(true)
    try{
      await api.patch('/EditTask', {
        id: task.id,
        rotation_user_ids: task.rotation_order_user_ids
      })
      await load()
    } finally { setSaving(false) }
  }

  const saveInterval = async (task, newInterval) => {
    setSaving(true)
    try{
      await api.patch('/EditTask', { id: task.id, interval_days: Number(newInterval)||null })
      await load()
    } finally { setSaving(false) }
  }

  // Assignments (pending) -> User umhängen
  const pendingByTask = useMemo(() => {
    const map = {}
    for (const a of assignments){
      if (a.status!=='PENDING') continue
      if (!map[a.task_id]) map[a.task_id] = []
      map[a.task_id].push(a)
    }
    return map
  }, [assignments])

  const reassign = async (assignmentId, newUserId) => {
    const fd = new FormData()
    fd.append('assignment_id', String(assignmentId))
    fd.append('new_user_id', String(newUserId))
    // ohne until_timestamp = dauerhaft
    await fetch(apiBase + '/SwitchUserTaskAssignmentTemporarily', { method:'POST', body: fd })
    await load()
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-red-600">{String(error)}</div>}
      <div className="flex items-center gap-2">
        <button onClick={load} className="px-3 py-2 rounded-lg bg-gray-900 text-white">Neu laden</button>
        {saving && <span className="text-sm text-gray-600">Speichere…</span>}
      </div>

      <div className="space-y-3">
        {tasks.map(t => {
          const isOpen = openId === t.id
          const pend = pendingByTask[t.id] || []
          return (
            <div key={t.id} className="rounded-xl border bg-white">
              <button
                onClick={()=>setOpenId(isOpen?null:t.id)}
                className="w-full text-left px-4 py-3 flex items-center justify-between"
              >
                <div className="font-medium truncate">{t.title} <span className="text-xs text-gray-500">#{t.id}</span></div>
                <div className="text-sm text-gray-500">{t.task_type}</div>
              </button>
              {isOpen && (
                <div className="px-4 pb-4 space-y-4">
                  {t.task_type==='ROTATING' && (
                    <div className="space-y-2">
                      <div className="text-sm text-gray-600">Rotation bearbeiten</div>
                      <div className="flex flex-wrap gap-2">
                        {(t.rotation_order_user_ids||[]).map((uid, idx) => (
                          <div key={uid} className="flex items-center gap-1 border rounded-full px-2 py-1 bg-gray-50">
                            <span className="text-sm">{nameById(uid)}</span>
                            <button className="px-1" onClick={()=>onRotationMove(t.id, idx, -1)} aria-label="Hoch">↑</button>
                            <button className="px-1" onClick={()=>onRotationMove(t.id, idx, +1)} aria-label="Runter">↓</button>
                            <button className="px-1 text-rose-600" onClick={()=>onRotationRemove(t.id, uid)} aria-label="Entfernen">✕</button>
                          </div>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <select onChange={(e)=>{ const val=Number(e.target.value)||null; if(val) onRotationAdd(t.id, val); e.target.value='' }} className="border rounded-lg px-2 py-1">
                          <option value="">User hinzufügen…</option>
                          {users.filter(u => !(t.rotation_order_user_ids||[]).includes(u.id)).map(u => (
                            <option key={u.id} value={u.id}>{u.name}</option>
                          ))}
                        </select>
                        <button onClick={()=>saveRotation(t)} className="px-3 py-2 rounded-lg bg-indigo-600 text-white">Reihenfolge speichern</button>
                      </div>
                    </div>
                  )}

                  {t.task_type==='RECURRING_UNASSIGNED' && (
                    <div className="space-y-2">
                      <div className="text-sm text-gray-600">Intervall (Tage) anpassen</div>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          defaultValue={t.interval_days ?? ''}
                          onBlur={(e)=>saveInterval(t, e.target.value)}
                          className="border rounded-lg px-3 py-2 w-32"
                        />
                        <div className="text-xs text-gray-500">Änderung wird beim Verlassen des Felds gespeichert.</div>
                      </div>
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="text-sm text-gray-600">Offene Zuweisungen</div>
                    {pend.length === 0 ? (
                      <div className="text-sm text-gray-500">Keine offenen Assignments.</div>
                    ) : (
                      <div className="space-y-2">
                        {pend.map(a => (
                          <div key={a.id} className="flex items-center gap-2">
                            <div className="text-sm">#{a.id}</div>
                            <div className="text-sm">aktuell: <span className="font-medium">{nameById(a.user_id)}</span></div>
                            <select
                              defaultValue={a.user_id || ''}
                              onChange={(e)=>reassign(a.id, Number(e.target.value))}
                              className="border rounded-lg px-2 py-1"
                            >
                              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                            </select>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
