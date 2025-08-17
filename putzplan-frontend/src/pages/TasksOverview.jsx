import React, { useEffect, useMemo, useState } from 'react'
import PageShell from '../components/PageShell'
import Avatar from '../components/Avatar'
import Modal from '../components/Modal'
import { useApi } from '../utils/api'
import { dueGradient, daysLeft } from '../utils/due.jsx'
import { navTo } from '../utils/router'
import { getCurrentUserId, setCurrentUserId } from '../utils/currentUser'

export default function TasksOverview({ apiBase }){
  const api = useApi(apiBase)
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  // Claim-Modal state
  const [claimOpen, setClaimOpen] = useState(false)
  const [claimTask, setClaimTask] = useState(null)
  const [claimUserId, setClaimUserId] = useState(getCurrentUserId())
  const [rememberMe, setRememberMe] = useState(true)
  const [claimErr, setClaimErr] = useState('')

  // Optimistische „Putzen!“-Markierung (lokal bis Reload)
  const [putzenNow, setPutzenNow] = useState({}) // { [taskId]: true }

  const load = async () => {
    try{
      setLoading(true)
      const [t,u,a] = await Promise.all([
        api.get('/ListAllTasks'),
        api.get('/ListAllUser'),
        api.get('/ListAssignments'),
      ])
      setTasks(t||[]); setUsers(u||[]); setAssignments(a||[])
      if (!claimUserId && (u||[]).length) setClaimUserId(u[0].id)
      // beim Reload bleibt „Putzen!“ aktiv, wenn urgency_score > 0
    }catch(e){ setError(e.message) } finally { setLoading(false) }
  }
  useEffect(()=>{ load() }, [apiBase])

  // Pending-Assignment mit user_id pro Task
  const pendingAssignedByTask = useMemo(()=>{
    const map = new Map()
    for (const a of assignments){
      if (a.status === 'PENDING' && a.user_id != null && !map.has(a.task_id)){
        map.set(a.task_id, a)
      }
    }
    return map
  }, [assignments])

  // Pending-Assignment ohne user_id (claimbar)
  const pendingUnassignedByTask = useMemo(()=>{
    const map = new Map()
    for (const a of assignments){
      if (a.status === 'PENDING' && a.user_id == null && !map.has(a.task_id)){
        map.set(a.task_id, a)
      }
    }
    return map
  }, [assignments])

  const markDone = async (taskId) => {
    const a = pendingAssignedByTask.get(taskId)
    if(!a) return
    const fd = new FormData()
    fd.append('assignment_id', String(a.id))
    await fetch(apiBase + '/MarkTaskDone', { method:'POST', body: fd })
    await load()
  }

  // NEU: Putzen!
  const putzen = async (taskId) => {
    // sofortiges visuelles Feedback
    setPutzenNow(m => ({...m, [taskId]: true}))
    const userId = getCurrentUserId() || users[0]?.id || 1
    const fd = new FormData()
    fd.append('task_id', taskId)
    fd.append('user_id', userId)
    await fetch(apiBase + '/VoteTaskUrgencyUp_do', { method:'POST', body: fd })
    await load()
  }

  const openClaim = (task) => {
    setClaimTask(task); setClaimErr('')
    if (!claimUserId && users.length) setClaimUserId(users[0].id)
    setClaimOpen(true)
  }
  const doClaim = async () => {
    setClaimErr('')
    if(!claimTask || !claimUserId) return
    const fd = new FormData()
    fd.append('task_id', String(claimTask.id))
    fd.append('user_id', String(claimUserId))
    const res = await fetch(apiBase + '/ClaimTask', { method:'POST', body: fd })
    if (!res.ok){
      const txt = await res.text().catch(()=> '')
      setClaimErr(txt || 'Konnte nicht claimen (evtl. bereits zugewiesen)')
      return
    }
    if (rememberMe) setCurrentUserId(claimUserId)
    setClaimOpen(false); setClaimTask(null)
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

  const TypeIcon = ({ type }) => {
    if (type === 'ROTATING') return <span title="Rotierend" aria-label="Rotierend" className="text-lg">🔁</span>
    if (type === 'RECURRING_UNASSIGNED') return <span title="Wiederkehrend (unassigned)" aria-label="Wiederkehrend" className="text-lg">🐦</span>
    return <span title="Einmalig" aria-label="Einmalig" className="inline-flex items-center justify-center rounded bg-gray-900 text-white px-1.5 py-0.5 text-[11px] leading-none" style={{fontWeight:700}}>1×</span>
  }

  const assigneeIdFor = (t) => {
    const a = pendingAssignedByTask.get(t.id)
    return a?.user_id ?? t.next_assignee_user_id ?? null
  }

  const isPutzenActive = (t) => !!putzenNow[t.id] || Number(t.urgency_score) > 0

  // Sortierung: überfällige zuerst, dann Urgency
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
    <PageShell
      title="Tasks Übersicht"
      right={
        <button onClick={load} className="px-3 py-2 rounded-lg bg-gray-900 text-white">
          {loading ? 'Lädt…' : 'Neu laden'}
        </button>
      }
    >
      {error && <div className="mb-3 text-red-600">{String(error)}</div>}

      {sorted.length === 0 ? (
        <div className="text-gray-600">Keine Tasks vorhanden.</div>
      ) : (
        <div className="space-y-3">
          {sorted.map(t => {
            const assigneeId = assigneeIdFor(t)
            const pendingAssigned = pendingAssignedByTask.get(t.id)
            const pendingUnassigned = pendingUnassignedByTask.get(t.id)
            const isClaimable = !!pendingUnassigned && !assigneeId
            const baseStyle = t.task_type==='ONE_OFF' ? {} : dueGradient(t.next_due_at)
            const dangerStyle = isPutzenActive(t)
              ? { background: 'linear-gradient(90deg, rgba(239,68,68,0.28), rgba(239,68,68,0.10))' }
              : null

            return (
              <div
                key={t.id}
                style={{ ...baseStyle, ...(dangerStyle||{}) }}
                className={`rounded-2xl border shadow-sm hover:shadow-md transition cursor-pointer ${isPutzenActive(t)?'border-red-500':''}`}
                onClick={()=>navTo('task',{id:t.id})}
                title="Details öffnen"
              >
                {/* Putzen-Badge */}
                {isPutzenActive(t) && (
                  <div className="px-2 py-1 rounded-br-2xl bg-red-600 text-white text-xs inline-block">
                    Putzen!
                  </div>
                )}

                <div className="p-4 flex items-center gap-4">
                  {/* Linke Spalte */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-semibold truncate">{t.title}</div>
                      <div className="text-xs text-gray-600">#{t.id}</div>
                    </div>

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
                        {Array.isArray(t.rotation_user_ids) && t.rotation_user_ids.length
                          ? t.rotation_user_ids.map(id => nameById(id)).join(' → ')
                          : '—'}
                      </span>
                    </div>
                  </div>

                  {/* Rechte Spalte: Actions */}
                  <div
                    className="shrink-0 bg-white/40 backdrop-blur-[1px] rounded-xl border p-2 flex items-center gap-2"
                    onClick={(e)=>e.stopPropagation()}
                  >
                    {/* Claim wenn niemand zugewiesen */}
                    {isClaimable && (
                      <button
                        className="px-2 py-1 rounded bg-indigo-600 text-white"
                        title="Diesen Task nehmen"
                        onClick={()=>openClaim(t)}
                      >Claimen</button>
                    )}
                    {/* Erledigt nur, wenn jemand zugewiesen ist */}
                    {pendingAssigned && (
                      <button
                        className="px-2 py-1 rounded bg-emerald-600 text-white"
                        title="Als erledigt markieren"
                        onClick={()=>markDone(t.id)}
                      >✓ Erledigt</button>
                    )}
                    {/* Nur 'Putzen!' (kein Down) */}
                    <button
                      className="px-2 py-1 rounded bg-red-600 text-white font-semibold"
                      title="Jetzt priorisieren"
                      onClick={()=>putzen(t.id)}
                    >Putzen!</button>

                    {/* optional: Wert anzeigen */}
                    <span className="font-mono">{t.urgency_score}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Claim-Modal */}
      <Modal
        open={claimOpen}
        onClose={()=>setClaimOpen(false)}
        title={claimTask ? `Task claimen – ${claimTask.title}` : 'Task claimen'}
        footer={
          <>
            <label className="mr-auto text-sm flex items-center gap-2">
              <input type="checkbox" checked={rememberMe} onChange={(e)=>setRememberMe(e.target.checked)} />
              Als Standard merken
            </label>
            <button className="px-3 py-2 rounded-lg bg-gray-200" onClick={()=>setClaimOpen(false)}>Abbrechen</button>
            <button className="px-3 py-2 rounded-lg bg-indigo-600 text-white" onClick={doClaim}>Claim</button>
          </>
        }
      >
        {claimErr && <div className="mb-3 text-rose-600 text-sm">{String(claimErr)}</div>}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {users.map(u => (
            <button
              key={u.id}
              onClick={()=>setClaimUserId(u.id)}
              className={`p-3 rounded-xl border text-left flex items-center gap-3 ${claimUserId===u.id?'ring-2 ring-indigo-600':''}`}
            >
              <Avatar size={40} src={u.profile_picture_url ? (apiBase + u.profile_picture_url) : null} name={u.name} />
              <div className="font-medium truncate">{u.name}</div>
            </button>
          ))}
        </div>
      </Modal>
    </PageShell>
  )
}
