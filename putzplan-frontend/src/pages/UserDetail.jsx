import React, { useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import Avatar from '../components/Avatar'
import { useApi } from '../utils/api'
import { dueGradient, DueBadge } from '../utils/due.jsx'

export default function UserDetail({ apiBase, userId }){
  const api = useApi(apiBase)
  const [user, setUser] = useState(null)
  const [assignments, setAssignments] = useState([])
  const [tasks, setTasks] = useState([])
  const [users, setUsers] = useState([])
  const [error, setError] = useState(null)

  const [assignForm, setAssignForm] = useState({ task_id:'', due_days: 7 })
  const [switchState, setSwitchState] = useState({}) // { [id]: { new_user_id, until } }

  const load = async () => {
    try {
      const [allUsers, allTasks, list] = await Promise.all([
        api.get('/ListAllUser'),
        api.get('/ListAllTasks'),
        api.get(`/ListAssignments?user_id=${userId}`)
      ])
      setUsers(allUsers||[])
      setTasks(allTasks||[])
      setAssignments(list||[])
      setUser((allUsers||[]).find(x=>x.id===Number(userId)) || null)
    } catch(e){ setError(e.message) }
  }
  useEffect(()=>{ load() }, [apiBase, userId])

  const pending = assignments.filter(a=>a.status==='PENDING')
  const done = assignments.filter(a=>a.status==='DONE')

  const markDone = async (id) => { const fd=new FormData(); fd.append('assignment_id', id); await fetch(apiBase + '/MarkTaskDone', { method:'POST', body: fd }); await load() }

  const assignToUser = async (e) => { e.preventDefault(); if(!assignForm.task_id) return; const fd=new FormData(); fd.append('task_id', String(assignForm.task_id)); fd.append('user_id', String(userId)); fd.append('due_days', String(assignForm.due_days||7)); await fetch(apiBase + '/AssignTaskToUser', { method:'POST', body: fd }); setAssignForm({ task_id:'', due_days: 7 }); await load() }

  const switchTemp = async (assignmentId) => { const st = switchState[assignmentId] || {}; if(!st.new_user_id) return; const fd=new FormData(); fd.append('assignment_id', String(assignmentId)); fd.append('new_user_id', String(st.new_user_id)); if(st.until) fd.append('until_timestamp', new Date(st.until).toISOString()); await fetch(apiBase + '/SwitchUserTaskAssignmentTemporarily', { method:'POST', body: fd }); await load() }

  if(!user) return <PageShell title="User"><div className="text-gray-600">User nicht gefunden.</div></PageShell>
  const avatarSrc = user.profile_picture_url ? (apiBase + user.profile_picture_url) : null

  return (
    <PageShell title={user.name} right={<div className="flex items-center gap-3"><Avatar src={avatarSrc} name={user.name} size={32}/><span className="text-sm text-gray-500">Credits: {user.credits}</span></div>}>
      {error && <div className="mb-3 text-red-600">{String(error)}</div>}

      <div className="mb-6 p-4 bg-white rounded-xl border">
        <div className="text-lg font-medium mb-2">Task diesem User zuweisen</div>
        <form onSubmit={assignToUser} className="flex flex-wrap items-end gap-3">
          <div>
            <div className="text-xs uppercase text-gray-500">Task</div>
            <select value={assignForm.task_id} onChange={(e)=>setAssignForm({...assignForm, task_id:e.target.value})} className="border rounded-lg px-3 py-2 min-w-[240px]">
              <option value="">Task wählen…</option>
              {tasks.map(t=> <option key={t.id} value={t.id}>{t.title} (#{t.id})</option>)}
            </select>
          </div>
          <div>
            <div className="text-xs uppercase text-gray-500">Fällig in (Tagen)</div>
            <input type="number" value={assignForm.due_days} onChange={(e)=>setAssignForm({...assignForm, due_days:e.target.value})} className="border rounded-lg px-3 py-2 w-32"/>
          </div>
            <button type="submit" className="px-4 py-2 rounded-lg bg-blue-600 text-white">Zuweisen</button>
        </form>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <div>
          <div className="text-lg font-medium mb-2">Offene Assignments</div>
          <div className="flex items-center gap-3 text-sm text-gray-600 mb-2">
            <span className="inline-block h-4 w-4 rounded" style={{backgroundImage:'linear-gradient(90deg,#dcfce7,#86efac)'}}></span> viel Zeit
            <span className="inline-block h-4 w-4 rounded" style={{backgroundImage:'linear-gradient(90deg,#fef9c3,#fde68a)'}}></span> 1–2 Tage
            <span className="inline-block h-4 w-4 rounded" style={{backgroundImage:'linear-gradient(90deg,#fee2e2,#fecaca)'}}></span> fällig/überfällig
          </div>
          <div className="overflow-auto">
            <table className="min-w-full border text-sm">
              <thead className="bg-gray-100"><tr>
                <th className="p-2 border">ID</th><th className="p-2 border">Task</th><th className="p-2 border">Fällig</th><th className="p-2 border">Aktionen</th>
              </tr></thead>
              <tbody>
                {pending.map(a => (
                  <tr key={a.id} style={dueGradient(a.due_at)} className="bg-white align-top">
                    <td className="p-2 border">{a.id}</td>
                    <td className="p-2 border">{a.task_title}</td>
                    <td className="p-2 border">
                      {a.due_at ? (
                        <div className="flex items-center gap-2">
                          <span>{new Date(a.due_at).toLocaleString()}</span>
                          <DueBadge dueAt={a.due_at} />
                        </div>
                      ) : '—'}
                    </td>
                    <td className="p-2 border">
                      <div className="flex flex-col gap-2 min-w-[260px]">
                        <div className="flex gap-2">
                          <button onClick={()=>markDone(a.id)} className="px-2 py-1 rounded bg-emerald-600 text-white">Erledigt</button>
                        </div>
                        <div className="text-xs text-gray-500">Temporär umhängen</div>
                        <div className="flex flex-wrap items-end gap-2">
                          <select value={switchState[a.id]?.new_user_id||''} onChange={(e)=>setSwitchState(s=>({...s, [a.id]:{...(s[a.id]||{}), new_user_id:e.target.value}}))} className="border rounded-lg px-2 py-1 min-w-[160px]">
                            <option value="">User wählen…</option>
                            {users.filter(u=>u.id!==Number(userId)).map(u=> <option key={u.id} value={u.id}>{u.name}</option>)}
                          </select>
                          <input type="datetime-local" value={switchState[a.id]?.until||''} onChange={(e)=>setSwitchState(s=>({...s, [a.id]:{...(s[a.id]||{}), until:e.target.value}}))} className="border rounded-lg px-2 py-1"/>
                          <button onClick={()=>switchTemp(a.id)} className="px-2 py-1 rounded bg-indigo-600 text-white">Übertragen</button>
                        </div>
                      </div>
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
                <th className="p-2 border">ID</th><th className="p-2 border">Task</th><th className="p-2 border">Zeit</th>
              </tr></thead>
              <tbody>
                {done.slice(0,20).map(a => (
                  <tr key={a.id} className="odd:bg-white even:bg-gray-50">
                    <td className="p-2 border">{a.id}</td>
                    <td className="p-2 border">{a.task_title}</td>
                    <td className="p-2 border">{a.done_at ? new Date(a.done_at).toLocaleString() : '—'}</td>
                  </tr>
                ))}
                {done.length===0 && <tr><td className="p-2 border" colSpan={3}>Noch nichts erledigt</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </PageShell>
  )
}
