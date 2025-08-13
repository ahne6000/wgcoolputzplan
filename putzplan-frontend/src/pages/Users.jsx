import React, { useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import { useApi } from '../utils/api'

export default function Users({ apiBase, embed=false }){
  const api = useApi(apiBase)
  const [users, setUsers] = useState([])
  const [name, setName] = useState('')
  const [selectedUser, setSelectedUser] = useState(null)
  const [file, setFile] = useState(null)
  const [creditsDelta, setCreditsDelta] = useState(0)
  const [error, setError] = useState(null)

  const load = async () => { try { setUsers(await api.get('/ListAllUser')) } catch(e){ setError(e.message) } }
  useEffect(()=>{ load() }, [apiBase])

  const createUser = async (e) => { e.preventDefault(); if(!name.trim()) return; try{ await api.post('/CreateUser',{name}); setName(''); await load(); }catch(e){ setError(e.message) } }
  const uploadPic = async () => { if(!selectedUser||!file) return; const fd=new FormData(); fd.append('file',file); try{ await api.postForm(`/UploadProfilePicture/${selectedUser.id}`, fd); setFile(null); await load(); }catch(e){ setError(e.message) } }
  const changeCredits = async (sign) => { if(!selectedUser) return; const amount=Math.abs(Number(creditsDelta)||0); const path = sign>0?`/AddUserCredit/${selectedUser.id}`:`/SubstractUserCredits/${selectedUser.id}`; try{ await api.post(path,{amount}); setCreditsDelta(0); await load(); }catch(e){ setError(e.message) } }

  const inner = (
    <>
      {error && <div className="mb-3 text-red-600">{String(error)}</div>}
      <div className="grid md:grid-cols-2 gap-6">
        <form onSubmit={createUser} className="space-y-3">
          <div className="text-lg font-medium">User anlegen</div>
          <input value={name} onChange={(e)=>setName(e.target.value)} placeholder="Name" className="w-full border rounded-lg px-3 py-2" />
          <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 text-white">Anlegen</button>
        </form>
        <div className="space-y-3">
          <div className="text-lg font-medium">Profilbild & Credits</div>
          <select onChange={(e)=>setSelectedUser(users.find(u=>u.id===Number(e.target.value))||null)} className="w-full border rounded-lg px-3 py-2">
            <option value="">User wählen…</option>
            {users.map(u=> <option key={u.id} value={u.id}>{u.name} (Credits: {u.credits})</option>)}
          </select>
          <div className="flex items-center gap-2">
            <input type="file" onChange={(e)=>setFile(e.target.files?.[0]||null)} className="border rounded-lg px-3 py-2" />
            <button onClick={uploadPic} type="button" className="px-3 py-2 rounded-lg bg-blue-600 text-white">Upload</button>
          </div>
          <div className="flex items-center gap-2">
            <input type="number" value={creditsDelta} onChange={(e)=>setCreditsDelta(e.target.value)} className="w-32 border rounded-lg px-3 py-2" />
            <button onClick={()=>changeCredits(+1)} type="button" className="px-3 py-2 rounded-lg bg-emerald-600 text-white">+ Credits</button>
            <button onClick={()=>changeCredits(-1)} type="button" className="px-3 py-2 rounded-lg bg-rose-600 text-white">− Credits</button>
          </div>
        </div>
      </div>

      <div className="mt-6">
        <div className="text-lg font-medium mb-2">Alle User</div>
        <div className="overflow-auto">
          <table className="min-w-full border">
            <thead className="bg-gray-100"><tr>
              <th className="p-2 border">ID</th>
              <th className="p-2 border">Name</th>
              <th className="p-2 border">Credits</th>
              <th className="p-2 border">Bild</th>
            </tr></thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="odd:bg-white even:bg-gray-50">
                  <td className="p-2 border">{u.id}</td>
                  <td className="p-2 border">{u.name}</td>
                  <td className="p-2 border">{u.credits}</td>
                  <td className="p-2 border">{u.profile_picture_url ? <img src={apiBase + u.profile_picture_url} alt={u.name} className="h-10 w-10 rounded-full object-cover"/> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )

  if (embed) return inner
  return (
    <PageShell title="Users" right={<button onClick={load} className="px-3 py-2 rounded-lg bg-gray-900 text-white">Neu laden</button>}>
      {inner}
    </PageShell>
  )
}
