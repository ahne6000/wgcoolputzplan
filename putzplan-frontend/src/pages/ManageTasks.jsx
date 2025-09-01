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
  const [showArchived, setShowArchived] = useState(true)

  const load = async () => {
    try{
      const [t,u,a] = await Promise.all([
        api.get('/ListAllTasks?include_archived=1'),
        api.get('/ListAllUser'),
        api.get('/ListAssignments')
      ])
      setTasks(t||[]); setUsers(u||[]); setAssignments(a||[])
    }catch(e){ setError(e.message) }
  }
  useEffect(()=>{ load() }, [apiBase])

  const nameById = (id) => users.find(u=>u.id===id)?.name || (id ? `#${id}` : '—')

  // -------- Sortierung zuerst definieren!
  const sorter = (a,b) => {
    const rA = a.rest_days == null ? 9999 : a.rest_days
    const rB = b.rest_days == null ? 9999 : b.rest_days
    const oA = rA <= 0 ? 1 : 0
    const oB = rB <= 0 ? 1 : 0
    if (oA !== oB) return oB - oA               // überfällige zuerst
    if (rA !== rB) return rA - rB               // dann nach Resttagen
    const uA = Number(a.urgency_score || 0)
    const uB = Number(b.urgency_score || 0)
    return uB - uA                               // dann nach Urgency
  }

  // -------- Active / Archived Listen
  const active   = useMemo(()=> (tasks||[]).filter(t=>!t.archived).sort(sorter), [tasks])
  const archived = useMemo(()=> (tasks||[]).filter(t=> t.archived).sort(sorter), [tasks])

  // -------- Rotation Helpers (mit robustem Fallback)
  const currentRotation = (t) => {
    return Array.isArray(t.rotation_order_user_ids) && t.rotation_order_user_ids.length
      ? t.rotation_order_user_ids
      : (Array.isArray(t.rotation_user_ids) ? t.rotation_user_ids : [])
  }

  const moveInArray = (arr, from, to) => {
    const a = [...arr]
    const item = a.splice(from,1)[0]
    a.splice(to,0,item)
    return a
  }

  const onRotationMove = (taskId, idx, dir) => {
    setTasks(ts => ts.map(t => {
      if (t.id!==taskId) return t
      const arr = currentRotation(t)
      const to = Math.min(arr.length-1, Math.max(0, idx+dir))
      return { ...t, rotation_order_user_ids: moveInArray(arr, idx, to) }
    }))
  }

  const onRotationRemove = (taskId, userId) => {
    setTasks(ts => ts.map(t => {
      if (t.id!==taskId) return t
      const arr = currentRotation(t).filter(id => id!==userId)
      return { ...t, rotation_order_user_ids: arr }
    }))
  }

  const onRotationAdd = (taskId, userId) => {
    setTasks(ts => ts.map(t => {
      if (t.id!==taskId) return t
      const arr = [...currentRotation(t), userId]
      return { ...t, rotation_order_user_ids: arr }
    }))
  }

  const saveRotation = async (task) => {
    setSaving(true)
    try{
      await api.patch('/EditTask', {
        id: task.id,
        rotation_user_ids: (task.rotation_order_user_ids && task.rotation_order_user_ids.length
          ? task.rotation_order_user_ids
          : (task.rotation_user_ids || []))
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

const shiftTask = async (taskId, delta) => {
  const fd = new FormData()
  fd.append('task_id', String(taskId))
  fd.append('delta_days', String(delta))
  await fetch(apiBase + '/ShiftTaskDueDays', { method:'POST', body: fd })
  await load()
}

const setTaskNextDueDate = async (taskId, ymd, keepTimeFrom) => {
  if (!ymd) return
  let base = keepTimeFrom ? new Date(keepTimeFrom) : new Date()
  const hh = base.getUTCHours().toString().padStart(2,'0')
  const mm = base.getUTCMinutes().toString().padStart(2,'0')
  const iso = `${ymd}T${hh}:${mm}:00Z`
  const fd = new FormData()
  fd.append('task_id', String(taskId))
  fd.append('next_due_at', iso)
  await fetch(apiBase + '/SetTaskNextDueAt', { method:'POST', body: fd })
  await load()
}


  // -------- Archiv / Delete Helpers
  const callTaskAction = async (path, task_id) => {
    const fd = new FormData()
    fd.append('task_id', String(task_id))
    const res = await fetch(apiBase + path, { method:'POST', body: fd })
    if(!res.ok) alert(await res.text())
    await load()
  }

  // -------- Assignments (pending) -> User umhängen
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
    await fetch(apiBase + '/SwitchUserTaskAssignmentTemporarily', { method:'POST', body: fd })
    await load()
  }

    // Punkte speichern
    const savePoints = async (task, newPoints) => {
      setSaving(true)
      try {
        const p = Number(newPoints)
        const val = Number.isFinite(p) ? p : 0
        await api.patch('/EditTask', { id: task.id, points: val })
        // lokal mergen, damit kein Full-Reload nötig ist
        setTasks(ts => ts.map(tt => tt.id === task.id ? { ...tt, points: val } : tt))
      } finally { setSaving(false) }
    }



  // -------- Renderkarte (wiederverwendet für aktiv/archiv)
const TaskCard = React.memo(function TaskCard({ t }) {
  const isOpen = openId === t.id
  const pend = pendingByTask[t.id] || []
  const rotationArray = currentRotation(t)

  // Lokaler Kommentar-Draft pro Karte
  const [desc, setDesc] = useState(t.description || '')
  const [savingLocal, setSavingLocal] = useState(false)

  // Wenn eine andere Task-Karte aufgeht/neu geladen wird, Draft nachziehen
  useEffect(() => {
    setDesc(t.description || '')
  }, [t.id, t.description])

  const isDirty = desc !== (t.description || '')

  const saveDescription = async () => {
    setSavingLocal(true)
    try {
      await api.patch('/EditTask', { id: t.id, description: desc || null })
      // Parent-State minimal mergen – kein Full-Reload
      setTasks(ts => ts.map(tt => (tt.id === t.id ? { ...tt, description: desc } : tt)))
    } finally {
      setSavingLocal(false)
    }
  }

  const resetDescription = () => setDesc(t.description || '')

  return (
    <div className={`rounded-xl border ${t.archived ? 'bg-gray-50 opacity-80' : 'bg-white'}`}>
      <button
        onClick={()=>setOpenId(isOpen?null:t.id)}
        className="w-full text-left px-4 py-3 flex items-center justify-between"
        type="button"
      >
        <div className="flex items-center gap-2">
          {t.archived && <span className="text-xs px-2 py-0.5 rounded bg-amber-100 text-amber-800">Archiviert</span>}
          <div className="font-medium truncate">{t.title} <span className="text-xs text-gray-500">#{t.id}</span></div>
        </div>
        <div className="flex items-center gap-2">
          <div className="text-sm text-gray-500">{t.task_type}</div>
          {!t.archived ? (
            <>
              <button onClick={(e)=>{e.stopPropagation(); callTaskAction('/ArchiveTask', t.id)}} className="px-2 py-1 rounded bg-amber-600 text-white text-xs" type="button">Archivieren</button>
              <button onClick={(e)=>{e.stopPropagation(); callTaskAction('/DeleteTask', t.id)}} className="px-2 py-1 rounded bg-red-700 text-white text-xs" type="button">Löschen</button>
            </>
          ) : (
            <>
              <button onClick={(e)=>{e.stopPropagation(); callTaskAction('/UnarchiveTask', t.id)}} className="px-2 py-1 rounded bg-slate-600 text-white text-xs" type="button">Wieder aktivieren</button>
              <button onClick={(e)=>{e.stopPropagation(); callTaskAction('/DeleteTask', t.id)}} className="px-2 py-1 rounded bg-red-700 text-white text-xs" type="button">Löschen</button>
            </>
          )}
        </div>
      </button>

      {isOpen && (
        <div
          className="px-4 pb-4 space-y-4"
          // Safety: Klicke im Body sollen nie das Header-Button toggeln
          onMouseDownCapture={(e)=>e.stopPropagation()}
          onClick={(e)=>e.stopPropagation()}
        >
          {t.task_type==='ROTATING' && (

            <div className="space-y-2">
              <div className="text-sm text-gray-600">Intervall (Tage) anpassen</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  defaultValue={t.interval_days ?? ''}
                  onBlur={(e)=>saveInterval(t, e.target.value)}
                  className="border rounded-lg px-3 py-2 w-32"
                  disabled={t.archived}
                />
                <div className="text-xs text-gray-500">Änderung wird beim Verlassen des Felds gespeichert.</div>
              </div>

        {/* Punkte (Credits) – für alle Task-Typen */}
        <div className="space-y-2">
          <div className="text-sm text-gray-600">Punkte (Credits)</div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              defaultValue={t.points ?? 0}
              onBlur={(e)=> savePoints(t, e.target.value)}
              className="border rounded-lg px-3 py-2 w-32"
              disabled={t.archived}
            />
            <div className="text-xs text-gray-500">Speichert beim Verlassen des Felds.</div>
          </div>
        </div>


              <div className="text-sm text-gray-600">Rotation bearbeiten</div>
              <div className="flex flex-wrap gap-2">
                {rotationArray.map((uid, idx) => (
                  <div key={`${uid}-${idx}`} className="flex items-center gap-1 border rounded-full px-2 py-1 bg-gray-50">
                    <span className="text-sm">{nameById(uid)}</span>
                    <button className="px-1" onClick={()=>onRotationMove(t.id, idx, -1)} aria-label="Hoch" type="button">↑</button>
                    <button className="px-1" onClick={()=>onRotationMove(t.id, idx, +1)} aria-label="Runter" type="button">↓</button>
                    <button className="px-1 text-rose-600" onClick={()=>onRotationRemove(t.id, uid)} aria-label="Entfernen" type="button">✕</button>
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <select onChange={(e)=>{ const val=Number(e.target.value)||null; if(val) onRotationAdd(t.id, val); e.target.value='' }} className="border rounded-lg px-2 py-1">
                  <option value="">User hinzufügen…</option>
                  {users.filter(u => !rotationArray.includes(u.id)).map(u => (
                    <option key={u.id} value={u.id}>{u.name}</option>
                  ))}
                </select>
                <button onClick={()=>saveRotation(t)} className="px-3 py-2 rounded-lg bg-indigo-600 text-white" disabled={saving} type="button">
                  {saving ? 'Speichere…' : 'Reihenfolge speichern'}
                </button>
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
                  disabled={t.archived}
                />
                <div className="text-xs text-gray-500">Änderung wird beim Verlassen des Felds gespeichert.</div>
              </div>
            </div>
          )}

      {/* Punkte (Credits) – für alle Task-Typen */}
<div className="space-y-2">
  <div className="text-sm text-gray-600">Punkte (Credits)</div>
  <div className="flex items-center gap-2">
    <input
      type="number"
      defaultValue={t.points ?? 0}
      onBlur={(e)=> savePoints(t, e.target.value)}
      className="border rounded-lg px-3 py-2 w-32"
      disabled={t.archived}
    />
    <div className="text-xs text-gray-500">Speichert beim Verlassen des Felds.</div>
  </div>
</div>


          {t.task_type==='ONE_OFF' && (
            <div className="space-y-2">
              <div className="text-sm text-gray-600">Intervall (Tage) für One-Off</div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  defaultValue={t.interval_days ?? ''}
                  onBlur={(e)=>saveInterval(t, e.target.value)}
                  className="border rounded-lg px-3 py-2 w-32"
                  disabled={t.archived}
                />
                <div className="text-xs text-gray-500">Wirkt für die initiale Fälligkeit.</div>
              </div>
            </div>
          )}

          <div className="space-y-2">
            <div className="text-sm text-gray-600">Offene Zuweisungen</div>
            { (pend||[]).length === 0 ? (
              <div className="text-sm text-gray-500">Keine offenen Assignments.</div>
            ) : (
              <div className="space-y-2">
                { (pend||[]).map(a => (
                  <div key={a.id} className="flex items-center gap-2">
                    <div className="text-sm">#{a.id}</div>
                    <div className="text-sm">aktuell: <span className="font-medium">{nameById(a.user_id)}</span></div>
                    <select
                      defaultValue={a.user_id || ''}
                      onChange={(e)=>reassign(a.id, Number(e.target.value))}
                      className="border rounded-lg px-2 py-1"
                      disabled={t.archived}
                    >
                      {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </div>



            {/* Fälligkeit verschieben */}
            <div className="space-y-2">
              <div className="text-sm text-gray-600">Fälligkeit</div>
              <div className="flex flex-wrap items-center gap-2">
                <button className="px-2 py-1 rounded border" onClick={()=>shiftTask(t.id, -7)} disabled={t.archived} type="button">−7d</button>
                <button className="px-2 py-1 rounded border" onClick={()=>shiftTask(t.id, -1)} disabled={t.archived} type="button">−1d</button>
                <button className="px-2 py-1 rounded border" onClick={()=>shiftTask(t.id, +1)} disabled={t.archived} type="button">+1d</button>
                <button className="px-2 py-1 rounded border" onClick={()=>shiftTask(t.id, +7)} disabled={t.archived} type="button">+7d</button>

                <span className="ml-2 text-sm text-gray-500">
                  {t.next_due_at ? new Date(t.next_due_at).toLocaleDateString() : '—'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="date"
                  defaultValue={t.next_due_at ? new Date(t.next_due_at).toISOString().slice(0,10) : ''}
                  onBlur={(e)=> e.target.value && setTaskNextDueDate(t.id, e.target.value, t.next_due_at)}
                  className="border rounded-lg px-3 py-2 w-[180px]"
                  disabled={t.archived}
                />
                <div className="text-xs text-gray-500">Datum setzen (Zeit bleibt gleich).</div>
              </div>
            </div>




          {/* Kommentar / Beschreibung */}
          <div className="space-y-2">
            <div className="text-sm text-gray-600">Kommentar / Beschreibung</div>

            <textarea
              value={desc}
              onChange={(e)=> setDesc(e.target.value)}
              placeholder="Notizen zum Task…"
              className="w-full border rounded-lg px-3 py-2 min-h-[90px]"
              disabled={t.archived}
            />

            <div className="flex items-center gap-2 text-xs">
              {isDirty
                ? <span className="text-amber-700">• Nicht gespeichert</span>
                : <span className="text-gray-500">Gespeichert</span>}

              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={resetDescription}
                  className="px-2 py-1 rounded border"
                  disabled={!isDirty || savingLocal}
                  type="button"
                >
                  Zurücksetzen
                </button>
                <button
                  onClick={saveDescription}
                  className="px-3 py-2 rounded-lg bg-indigo-600 text-white"
                  disabled={!isDirty || savingLocal}
                  type="button"
                >
                  {savingLocal ? 'Speichere…' : 'Kommentar speichern'}
                </button>
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  )
})




  return (
    <div className="space-y-4">
      {error && <div className="text-red-600">{String(error)}</div>}
      <div className="flex items-center gap-4">
        <button onClick={load} className="px-3 py-2 rounded-lg bg-gray-900 text-white">Neu laden</button>
        {saving && <span className="text-sm text-gray-600">Speichere…</span>}
        <label className="text-sm flex items-center gap-2 ml-auto">
          <input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)} />
          Archivierte anzeigen
        </label>
      </div>

      {/* Aktive */}
      <div className="space-y-3">
        {active.map(t => <TaskCard key={t.id} t={t} />)}
        {active.length===0 && <div className="text-sm text-gray-600">Keine aktiven Tasks.</div>}
      </div>

      {/* Archivierte */}
      {showArchived && (
        <div className="space-y-3 pt-4">
          <div className="text-lg font-medium">Archivierte Tasks</div>
          {archived.map(t => <TaskCard key={t.id} t={t} />)}
          {archived.length===0 && <div className="text-sm text-gray-600">Keine archivierten Tasks.</div>}
        </div>
      )}
    </div>
  )
}
