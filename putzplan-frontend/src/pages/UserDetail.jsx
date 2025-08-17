// src/pages/UserDetail.jsx
import React, { useEffect, useMemo, useState } from 'react'
import PageShell from '../components/PageShell'
import Avatar from '../components/Avatar'
import { useApi } from '../utils/api'
import { daysLeft, dueGradient, DueBadge } from '../utils/due.jsx'
import { navTo } from '../utils/router'
import Stats from '../components/Stats'

export default function UserDetail({ apiBase, userId }){
  const api = useApi(apiBase)
  const [user, setUser] = useState(null)
  const [allUsers, setAllUsers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [tasks, setTasks] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  // Optimistische „Putzen!“ Marker (taskId -> true)
  const [putzenNow, setPutzenNow] = useState({})

  const load = async () => {
    try{
      setLoading(true)
      const [usersArr, a, t] = await Promise.all([
        api.get('/ListAllUser'),
        api.get('/ListAssignments?user_id='+userId),
        api.get('/ListAllTasks'),
      ])
      setAllUsers(usersArr || [])
      setUser((usersArr || []).find(u=>u.id===Number(userId)) || null)
      setAssignments(a||[])
      setTasks(t||[])
      setPutzenNow({})
    }catch(e){ setError(e.message) } finally { setLoading(false) }
  }
  useEffect(()=>{ load() }, [apiBase, userId])

  // Lookups
  const usersMap = useMemo(()=>{
    const m = new Map()
    for (const u of allUsers) m.set(u.id, u)
    return m
  }, [allUsers])
  const taskById = (id) => tasks.find(x=>x.id===id) || null
  const nameById = (id) => usersMap.get(id)?.name || (id ? `#${id}` : '—')

  const pending = useMemo(()=> assignments.filter(a=>a.status==='PENDING'), [assignments])
  const done    = useMemo(()=> assignments.filter(a=>a.status==='DONE').sort((a,b)=>(new Date(b.done_at||0))-(new Date(a.done_at||0))), [assignments])

  const resttageNum = (t) => {
    if (!t || t.task_type==='ONE_OFF' || !t.next_due_at) return null
    return Math.max(0, Math.ceil(daysLeft(t.next_due_at)))
  }

  // Aktionen
  const markDone = async (assignmentId) => {
    const fd = new FormData(); fd.append('assignment_id', String(assignmentId))
    await fetch(apiBase + '/MarkTaskDone', { method:'POST', body: fd })
    await load()
  }
  const putzen = async (taskId) => {
    setPutzenNow(m => ({...m, [taskId]: true}))
    const fd = new FormData()
    fd.append('task_id', String(taskId))
    fd.append('user_id', String(userId))
    await fetch(apiBase + '/VoteTaskUrgencyUp_do', { method:'POST', body: fd })
    await load()
  }

  // ---- Stats: Erwartungswert (Soll) berechnen ----
  function expectedPerWeekPerUser(allTasks, usersCount){
    const uCount = Math.max(1, Number(usersCount||0))
    let sum = 0
    for (const t of allTasks){
      const pts = Number(t.points || 0)
      const every = Number(t.interval_days || 0)
      if (!every || t.task_type === 'ONE_OFF') continue
      const weekly = pts * (7 / every)
      if (t.task_type === 'ROTATING'){
        const n = Math.max(1, (t.rotation_user_ids?.length || 0))
        sum += weekly / n
      } else if (t.task_type === 'RECURRING_UNASSIGNED'){
        sum += weekly / uCount
      }
    }
    return sum
  }
  const expectedWeek = useMemo(()=> expectedPerWeekPerUser(tasks, allUsers.length), [tasks, allUsers.length])

  // Daten für Charts vorbereiten
  const tasksMap = useMemo(()=>{
    const m = new Map()
    for (const t of tasks) m.set(t.id, t)
    return m
  }, [tasks])
  const doneForUser = useMemo(()=> assignments.filter(a=>a.status==='DONE'), [assignments])

  const name = user?.name || '—'
  const avatarSrc = user?.profile_picture_url ? (apiBase + user.profile_picture_url) : null

  return (
    <PageShell
      title={user ? `User – ${name}` : 'User'}
      right={
        <button onClick={load} className="px-3 py-2 rounded-lg bg-gray-900 text-white">
          {loading ? 'Lädt…' : 'Neu laden'}
        </button>
      }
    >
      {error && <div className="mb-3 text-red-600">{String(error)}</div>}

      {/* Kopf */}
      <div className="flex items-center gap-3 mb-4">
        <Avatar size={48} src={avatarSrc} name={name} />
        <div>
          <div className="text-lg font-semibold">{name}</div>
          <div className="text-sm text-gray-600">Credits: <span className="font-medium">{user?.credits ?? 0}</span></div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <Stats
          doneAssignments={doneForUser}
          tasksById={tasksMap}
          expectedPerWeekPerUser={expectedWeek}
          mode="week"
          weeks={8}
        />
        <Stats
          doneAssignments={doneForUser}
          tasksById={tasksMap}
          expectedPerWeekPerUser={expectedWeek}
          mode="day"
          days={14}
        />
      </div>
      <div className="mb-6 rounded-xl border p-3 bg-white">
        <div className="text-sm text-gray-600">
          Soll/Woche: <span className="font-medium">{Math.round(expectedWeek)}</span> Credits
          <span className="mx-2">•</span>
          Soll/Tag: <span className="font-medium">{Math.round(expectedWeek/7)}</span> Credits
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Offene Assignments – Kacheln wie in Übersicht */}
        <div>
          <div className="text-lg font-medium mb-2">Offene Assignments</div>
          <div className="space-y-3">
            {pending.length===0 && <div className="text-sm text-gray-600">Keine offenen Assignments.</div>}
            {pending.map(a=>{
              const t = taskById(a.task_id)
              const baseStyle = (!t || t.task_type==='ONE_OFF') ? {} : dueGradient(t.next_due_at)
              const putzenActive = (t && Number(t.urgency_score)>0) || !!putzenNow[t?.id]

              return (
                <div
                  key={a.id}
                  style={{...baseStyle, ...(putzenActive?{ background: 'linear-gradient(90deg, rgba(239,68,68,0.28), rgba(239,68,68,0.10))'}:{})}}
                  className={`rounded-2xl border shadow-sm hover:shadow-md transition cursor-pointer ${putzenActive?'border-red-500':''}`}
                  onClick={()=> t && navTo('task',{id:t.id})}
                  title="Details öffnen"
                >
                  {putzenActive && (
                    <div className="px-2 py-1 rounded-br-2xl bg-red-600 text-white text-xs inline-block">
                      Putzen!
                    </div>
                  )}
                  <div className="p-4 flex items-center gap-4">
                    {/* Linke Spalte */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <div className="font-semibold truncate">{t ? t.title : (a.task_title || `Task #${a.task_id}`)}</div>
                        <div className="text-xs text-gray-600">#{a.task_id}</div>
                      </div>

                      <div className="mt-0.5">
                        <span className="text-gray-500 mr-1">Gerade dran:</span>
                        <span className="font-semibold text-base">{name}</span>
                      </div>

                      <div className="mt-1 text-sm text-gray-700 flex flex-wrap gap-x-4 gap-y-1 items-center">
                        <span>Intervall: <span className="font-medium">{t?.interval_days ?? '—'}</span></span>
                        <span>Punkte: <span className="font-medium">{t?.points ?? '—'}</span></span>
                        <span>Resttage: <span className="font-medium">{resttageNum(t) ?? '—'}</span></span>
                      </div>

                      <div className="mt-1 text-sm">
                        <span className="text-gray-500">Rotation:</span>{' '}
                        <span className="font-medium truncate">
                          {Array.isArray(t?.rotation_user_ids) && t.rotation_user_ids.length
                            ? t.rotation_user_ids.map(id=>nameById(id)).join(' → ')
                            : '—'}
                        </span>
                      </div>
                    </div>

                    {/* Rechte Spalte: Actions (stopPropagation, damit Karte nicht navigiert) */}
                    <div
                      className="shrink-0 bg-white/40 backdrop-blur-[1px] rounded-xl border p-2 flex items-center gap-2"
                      onClick={(e)=>e.stopPropagation()}
                    >
                      <button
                        className="px-2 py-1 rounded bg-emerald-600 text-white"
                        title="Als erledigt markieren"
                        onClick={()=>markDone(a.id)}
                      >✓ Erledigt</button>

                      <button
                        className="px-2 py-1 rounded bg-red-600 text-white font-semibold"
                        title="Jetzt priorisieren"
                        onClick={()=> t && putzen(t.id)}
                      >Putzen!</button>

                      <span className="font-mono">{t?.urgency_score ?? 0}</span>
                    </div>
                  </div>
                  {/* Fälligkeits-Badge wie in Detailseite */}
                  {t && t.task_type!=='ONE_OFF' && t.next_due_at && (
                    <div className="px-4 pb-3"><DueBadge dueAt={t.next_due_at}/></div>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        {/* Erledigt – neutrale Karten, klickbar zur Detailseite */}
        <div>
          <div className="text-lg font-medium mb-2">Erledigt (kürzlich)</div>
          <div className="space-y-3">
            {done.length===0 && <div className="text-sm text-gray-600">Noch nichts erledigt.</div>}
            {done.slice(0,20).map(a=>{
              const t = taskById(a.task_id)
              return (
                <div
                  key={a.id}
                  className="rounded-2xl border bg-white hover:shadow-md transition cursor-pointer"
                  onClick={()=> t && navTo('task',{id:t.id})}
                  title="Details öffnen"
                >
                  <div className="p-3 flex items-center justify-between">
                    <div>
                      <div className="font-medium">{t ? t.title : (a.task_title || `Task #${a.task_id}`)}</div>
                      <div className="text-sm text-gray-600">{a.done_at ? new Date(a.done_at).toLocaleString() : '—'}</div>
                    </div>
                    <div className="text-sm text-gray-600">
                      Punkte: <span className="font-medium">{t?.points ?? '—'}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </PageShell>
  )
}
