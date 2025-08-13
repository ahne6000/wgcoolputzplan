import React, { useEffect, useMemo, useState } from 'react'
import PageShell from '../components/PageShell'
import { useApi } from '../utils/api'
import { dueGradient, daysLeft } from '../utils/due.jsx'
import { navTo } from '../utils/router'

export default function TasksOverview({ apiBase }){
  const api = useApi(apiBase)
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [error, setError] = useState(null)

  const load = async () => {
    try{
      const [t,u,a] = await Promise.all([
        api.get('/ListAllTasks'),
        api.get('/ListAllUser'),
        api.get('/ListAssignments') // für „gerade dran“
      ])
      setTasks(t||[]); setUsers(u||[]); setAssignments(a||[])
    }catch(e){ setError(e.message) }
  }
  useEffect(()=>{ load() }, [apiBase])

  const vote = async (taskId, dir) => {
    const fd = new FormData()
    fd.append('task_id', taskId)
    fd.append('user_id', users[0]?.id || 1)
    await fetch(apiBase + (dir>0?'/VoteTaskUrgencyUp_do':'/VoteTaskUrgencyDown_do'), { method:'POST', body: fd })
    await load()
  }

  const nameById = (id) => users.find(u => u.id === id)?.name || (id ? `#${id}` : '—')

  const resttageNum = (due, type) => {
    if (type === 'ONE_OFF') return null
    if (!due) return null
    const d = Math.ceil(daysLeft(due))
    return d <= 0 ? 0 : d
  }
  const resttageLabel = (due, type) => {
    const n = resttageNum(due, type)
    return n === null ? '—' : n
  }

  // Typ-Icons
  const TypeIcon = ({ type }) => {
    if (type === 'ROTATING') return <span title="Rotierend" aria-label="Rotierend" className="text-lg">🔁</span>
    if (type === 'RECURRING_UNASSIGNED') return <span title="Wiederkehrend (unassigned)" aria-label="Wiederkehrend" className="text-lg">🐦</span>
    return <span title="Einmalig" aria-label="Einmalig" className="inline-flex items-center justify-center rounded bg-gray-900 text-white px-1.5 py-0.5 text-[11px] leading-none" style={{fontWeight:700}}>1×</span>
  }

  // Helper: wer ist „gerade dran“?
  const currentAssigneeId = (task) => {
    const list = assignments.filter(a => a.task_id === task.id)
    // 1) Falls es ein zugewiesenes offenes Assignment gibt → das ist „dran“
    const pendingAssigned = list.find(a => a.status === 'PENDING' && a.user_id != null)
    if (pendingAssigned) return pendingAssigned.user_id
    // 2) ROTATING: aus der Reihenfolge + letzte Erledigung den Nächsten bestimmen
    if (task.task_type === 'ROTATING' && Array.isArray(task.rotation_order_user_ids) && task.rotation_order_user_ids.length){
      const lastDone = [...list].filter(a=>a.status==='DONE' && a.user_id!=null)
        .sort((a,b)=> new Date(b.done_at||0) - new Date(a.done_at||0))[0]
      const order = task.rotation_order_user_ids
      if (!lastDone) return order[0]
      const idx = order.indexOf(lastDone.user_id)
      return idx>=0 ? order[(idx+1)%order.length] : order[0]
    }
    // 3) Sonst unbekannt/keiner
    return null
  }

  // Sortierung: überfällige zuerst (<=0), dann nach Urgency absteigend
  const sorted = useMemo(() => {
    const keyDue = (t) => {
      if(t.task_type==='ONE_OFF' || !t.next_due_at) return Number.POSITIVE_INFINITY
      const d = Math.ceil(daysLeft(t.next_due_at))
      return d <= 0 ? -1 : d
    }
    const keyUrg = (t) => Number(t.urgency_score || 0)
    return [...tasks].sort((a,b) => {
      const da = keyDue(a), db = keyDue(b)
      if (da !== db) return da - db
      return keyUrg(b) - keyUrg(a)
    })
  }, [tasks])

  return (
    <PageShell title="Tasks Übersicht" right={<button onClick={load} className="px-3 py-2 rounded-lg bg-gray-900 text-white">Neu laden</button>}>
      {error && <div className="mb-3 text-red-600">{String(error)}</div>}

      {sorted.length === 0 ? (
        <div className="text-gray-600">Keine Tasks vorhanden.</div>
      ) : (
        <div className="space-y-3">
          {sorted.map(t => {
            const assigneeId = currentAssigneeId(t)
            return (
              <div
                key={t.id}
                style={t.task_type==='ONE_OFF' ? {} : dueGradient(t.next_due_at)}
                className="rounded-2xl border shadow-sm hover:shadow-md transition cursor-pointer"
                onClick={()=>navTo('task',{id:t.id})}
                title="Details öffnen"
              >
                <div className="p-4 flex items-center gap-4">
                  {/* Linke Spalte */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold truncate">{t.title}</div>
                      <div className="text-xs text-gray-600">#{t.id}</div>
                    </div>

                    {/* PROMINENT: gerade dran */}
                    {assigneeId && (
                      <div className="mt-0.5">
                        <span className="text-gray-500 mr-1">Gerade dran:</span>
                        <span className="font-semibold text-base">{nameById(assigneeId)}</span>
                      </div>
                    )}

                    <div className="mt-1 text-sm text-gray-700 flex flex-wrap gap-x-4 gap-y-1 items-center">
                      <span className="flex items-center gap-1"><TypeIcon type={t.task_type} /></span>
                      <span>Intervall: <span className="font-medium">{t.interval_days ?? '—'}</span></span>
                      <span>Punkte: <span className="font-medium">{t.points}</span></span>
                      <span>Resttage: <span className="font-medium">{resttageLabel(t.next_due_at, t.task_type)}</span></span>
                    </div>

                    <div className="mt-1 text-sm">
                      <span className="text-gray-500">Rotation:</span>{' '}
                      <span className="font-medium truncate">
                        {Array.isArray(t.rotation_order_user_ids) && t.rotation_order_user_ids.length
                          ? t.rotation_order_user_ids.map(id => nameById(id)).join(' → ')
                          : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Rechte Spalte: Urgency */}
                  <div
                    className="shrink-0 bg-white/40 backdrop-blur-[1px] rounded-xl border p-2 flex items-center gap-2"
                    onClick={(e)=>e.stopPropagation()}
                  >
                    <button className="px-2 py-1 rounded bg-emerald-600 text-white" onClick={()=>vote(t.id, +1)}>▲</button>
                    <span className="font-mono">{t.urgency_score}</span>
                    <button className="px-2 py-1 rounded bg-rose-600 text-white" onClick={()=>vote(t.id, -1)}>▼</button>
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
