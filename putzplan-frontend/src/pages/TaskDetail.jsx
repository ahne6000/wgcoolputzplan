import React, { useEffect, useMemo, useState } from 'react'
import PageShell from '../components/PageShell'
import Avatar from '../components/Avatar'
import { useApi } from '../utils/api'
import { daysLeft, DueBadge } from '../utils/due.jsx'

export default function TaskDetail({ apiBase, taskId }){
  const api = useApi(apiBase)
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [assignments, setAssignments] = useState([])
  const [error, setError] = useState(null)

  const [voteUserId, setVoteUserId] = useState(null)
  const [assignNextDueDays, setAssignNextDueDays] = useState(7)

  // Optimistischer „Putzen!“ Zustand (bis Reload)
  const [putzenActiveLocal, setPutzenActiveLocal] = useState(false)

  const load = async () => {
    try {
      const [t, u, a] = await Promise.all([
        api.get('/ListAllTasks'),
        api.get('/ListAllUser'),
        api.get('/ListAssignments')
      ])
      setTasks(t||[]); setUsers(u||[]); setAssignments(a||[])
      setVoteUserId((u||[])[0]?.id || null)
      setPutzenActiveLocal(false) // nach frischem Load übernimmt Serverwert (urgency_score)
    } catch (e) { setError(e.message) }
  }
  useEffect(()=>{ load() }, [apiBase, taskId])

  const task = useMemo(()=> tasks.find(x=>x.id===Number(taskId)) || null, [tasks, taskId])

  const userById = (id) => users.find(u=>u.id===id)
  const nameById = (id) => userById(id)?.name || (id ? `#${id}` : '—')
  const avatarSrcById = (id) => {
    const u = userById(id)
    return u?.profile_picture_url ? (apiBase + u.profile_picture_url) : null
  }

  // Alle Assignments dieses Tasks
  const taskAssignments = useMemo(
    () => assignments.filter(a=>a.task_id===Number(taskId)),
    [assignments, taskId]
  )
  const pending = taskAssignments.filter(a=>a.status==='PENDING')
  const done = taskAssignments
    .filter(a=>a.status==='DONE')
    .sort((a,b)=> (new Date(b.done_at||0))-(new Date(a.done_at||0)))

  // „Gerade dran“:
  const currentAssigneeId = useMemo(() => {
    if (!task) return null
    const pa = pending.find(a => a.user_id != null)
    if (pa) return pa.user_id
    if (task.task_type==='ROTATING' && Array.isArray(task.rotation_user_ids) && task.rotation_user_ids.length){
      const lastDone = done.find(a => a.user_id != null)
      const order = task.rotation_user_ids
      if (!lastDone) return order[0]
      const idx = order.indexOf(lastDone.user_id)
      return idx>=0 ? order[(idx+1)%order.length] : order[0]
    }
    return null
  }, [task, pending, done])

  // Nächster User für ROTATING
  const nextUserId = useMemo(()=>{
    if(!task || task.task_type!=='ROTATING' || !Array.isArray(task.rotation_user_ids) || !task.rotation_user_ids.length) return null
    const lastDoneUserId = done[0]?.user_id ?? null
    const order = task.rotation_user_ids
    if(lastDoneUserId==null) return order[0]
    const idx = order.indexOf(lastDoneUserId)
    if(idx<0) return order[0]
    return order[(idx+1)%order.length]
  }, [task, done])

  // Aktionen
  const markDone = async (assignmentId) => {
    const fd = new FormData(); fd.append('assignment_id', assignmentId)
    await fetch(apiBase + '/MarkTaskDone', { method:'POST', body: fd })
    await load()
  }

  // „Putzen!“ nur nach oben, kein Down
  const putzen = async () => {
    if(!task || !voteUserId) return
    setPutzenActiveLocal(true) // sofort visuelles Feedback
    const fd = new FormData()
    fd.append('task_id', task.id)
    fd.append('user_id', voteUserId)
    await fetch(apiBase + '/VoteTaskUrgencyUp_do', { method:'POST', body: fd })
    await load()
  }

  const assignNextNow = async () => {
    if(!task || !nextUserId) return
    const fd = new FormData()
    fd.append('task_id', task.id)
    fd.append('user_id', nextUserId)
    fd.append('due_days', String(assignNextDueDays || 7))
    await fetch(apiBase + '/AssignTaskToUser', { method:'POST', body: fd })
    await load()
  }

  if(!task) return <PageShell title="Task"><div className="text-gray-600">Task nicht gefunden.</div></PageShell>

  const restTage = (task.task_type !== 'ONE_OFF' && task.next_due_at != null)
    ? Math.max(0, Math.ceil(daysLeft(task.next_due_at)))
    : null

  const isPutzenActive = putzenActiveLocal || Number(task.urgency_score) > 0

  return (
    <PageShell
      title={`Task #${task.id} – ${task.title}`}
      right={
        <div className="flex items-center gap-2">
          <select value={voteUserId??''} onChange={(e)=>setVoteUserId(Number(e.target.value)||null)} className="border rounded-lg px-2 py-1 text-sm">
            {users.map(u=> <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button onClick={putzen} className="px-2 py-1 rounded bg-red-600 text-white text-sm font-semibold">Putzen!</button>
        </div>
      }
    >
      {error && <div className="mb-3 text-red-600">{String(error)}</div>}

      {/* Putzen-Badge / Alert */}
      {isPutzenActive && (
        <div className="mb-4 px-3 py-2 inline-flex items-center gap-2 rounded-lg bg-red-600 text-white">
          <span className="text-sm font-semibold">Putzen!</span>
          <span className="text-xs opacity-90">Dieser Task ist eskaliert und sollte priorisiert werden.</span>
        </div>
      )}

      {/* GERade dran – prominent */}
      <div className={`mb-4 p-4 rounded-xl border bg-white flex items-center gap-3 ${isPutzenActive?'border-red-500':''}`}>
        <div className="text-sm text-gray-500">Gerade dran</div>
        <div className="flex items-center gap-3 ml-3">
          <Avatar size={40} src={avatarSrcById(currentAssigneeId)} name={nameById(currentAssigneeId)} />
          <div className="text-xl font-semibold">{nameById(currentAssigneeId)}</div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="grid md:grid-cols-2 gap-4">
          <div>
            <div className="text-sm text-gray-500">Beschreibung</div>
            <div className="mt-1 whitespace-pre-wrap">{task.description || '—'}</div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-sm text-gray-500">Typ</div>
              <div className="font-medium">{task.task_type}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Intervall (Tage)</div>
              <div className="font-medium">{task.interval_days ?? '—'}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Punkte</div>
              <div className="font-medium">{task.points}</div>
            </div>
            <div>
              <div className="text-sm text-gray-500">Urgency</div>
              <div className="font-medium">{task.urgency_score}</div>
            </div>

            {task.task_type !== 'ONE_OFF' && (
              <div className="col-span-2">
                <div className="text-sm text-gray-500">Nächste Fälligkeit</div>
                <div className="flex items-center gap-2">
                  <span className="font-medium">{restTage!=null ? `${restTage} Tage` : '—'}</span>
                  {task.next_due_at ? <DueBadge dueAt={task.next_due_at}/> : null}
                </div>
              </div>
            )}
          </div>
        </div>

        {task.task_type==='ROTATING' && (
          <div className="p-3 rounded-xl border">
            <div className="text-sm text-gray-500">Rotation</div>
            <div className="mt-1 text-sm">
              {task.rotation_user_ids?.map(id=>nameById(id)).join(' → ') || '—'}
            </div>
            <div className="mt-2 text-sm">
              Nächster: <span className="font-medium">{nextUserId ? nameById(nextUserId) : '—'}</span>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <input
                type="number"
                value={assignNextDueDays}
                onChange={(e)=>setAssignNextDueDays(Number(e.target.value)||7)}
                className="w-28 border rounded-lg px-2 py-1"
              />
              <button onClick={assignNextNow} className="px-3 py-2 rounded-lg bg-indigo-600 text-white">Nächsten zuweisen</button>
            </div>
          </div>
        )}

        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <div className="text-lg font-medium mb-2">Offene Assignments</div>
            <div className="overflow-auto">
              <table className="min-w-full border text-sm">
                <thead className="bg-gray-100"><tr>
                  <th className="p-2 border">Assign-ID</th><th className="p-2 border">User</th><th className="p-2 border">Fällig</th><th className="p-2 border">Aktionen</th>
                </tr></thead>
                <tbody>
                  {pending.map(a => (
                    <tr key={a.id} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2 border">{a.id}</td>
                      <td className="p-2 border">{a.user_id ? nameById(a.user_id) : '—'}</td>
                      <td className="p-2 border">{a.due_at && task.task_type!=='ONE_OFF' ? `${Math.max(0, Math.ceil(daysLeft(a.due_at)))} Tage` : '—'}</td>
                      <td className="p-2 border">
                        <button onClick={()=>markDone(a.id)} className="px-2 py-1 rounded bg-emerald-600 text-white">Als erledigt markieren</button>
                      </td>
                    </tr>
                  ))}
                  {pending.length===0 && <tr><td className="p-2 border" colSpan={4}>Keine offenen Assignments</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div className="text-lg font-medium mb-2">Erledigt (kürzlich)</div>
            <div className="overflow-auto">
              <table className="min-w-full border text-sm">
                <thead className="bg-gray-100"><tr>
                  <th className="p-2 border">Assign-ID</th><th className="p-2 border">User</th><th className="p-2 border">Zeit</th>
                </tr></thead>
                <tbody>
                  {done.slice(0,20).map(a => (
                    <tr key={a.id} className="odd:bg-white even:bg-gray-50">
                      <td className="p-2 border">{a.id}</td>
                      <td className="p-2 border">{a.user_id ? nameById(a.user_id) : '—'}</td>
                      <td className="p-2 border">{a.done_at ? new Date(a.done_at).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                  {done.length===0 && <tr><td className="p-2 border" colSpan={3}>Noch nichts erledigt</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
