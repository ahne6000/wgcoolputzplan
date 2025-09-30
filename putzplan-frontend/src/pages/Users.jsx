import React, { useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import { useApi } from '../utils/api'

export default function Users({ apiBase, embed=false }){
  const api = useApi(apiBase)

  // Daten
  const [users, setUsers] = useState([])
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(false)

  // Create
  const [name, setName] = useState('')

  // Auswahl + Aktionen
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [file, setFile] = useState(null)
  const [creditsDelta, setCreditsDelta] = useState(0)

  // Rename-Drafts
  const [nameDrafts, setNameDrafts] = useState({})
  const [savingId, setSavingId] = useState(null)

  const load = async () => {
    try {
      setLoading(true)
      setError(null)
      const us = await api.get('/ListAllUser')
      setUsers(us || [])
      // vorhandene Drafts erhalten; fehlende initialisieren
      setNameDrafts(d => {
        const next = { ...d }
        for (const u of us) {
          if (next[u.id] === undefined) next[u.id] = u.name || ''
        }
        // Auswahl nachladen, falls leer
        if (us && us.length && !selectedUserId) {
          setSelectedUserId(us[0].id)
        }
        return next
      })
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }
  useEffect(()=>{ load() }, [apiBase])

  const selectedUser = users.find(u => u.id === selectedUserId) || null

  // --- Create user ---
  const createUser = async (e) => {
    e.preventDefault()
    const nm = (name || '').trim()
    if (!nm) return
    try {
      await api.post('/CreateUser', { name: nm })
      setName('')
      await load()
    } catch (e) { setError(e.message) }
  }

  // --- Upload picture ---
  const uploadPic = async () => {
    if (!selectedUser || !file) return
    const fd = new FormData()
    fd.append('file', file)
    try{
      await api.postForm(`/UploadProfilePicture/${selectedUser.id}`, fd)
      setFile(null)
      await load()
    }catch(e){ setError(e.message) }
  }

  // --- Credits +/- ---
  const changeCredits = async (sign) => {
    if (!selectedUser) return
    const amount = Math.abs(Number(creditsDelta) || 0)
    if (!amount) return
    const path = sign > 0
      ? `/AddUserCredit/${selectedUser.id}`
      : `/SubstractUserCredits/${selectedUser.id}`
    try{
      await api.post(path, { amount })
      setCreditsDelta(0)
      await load()
    }catch(e){ setError(e.message) }
  }

  // --- Rename helpers ---
  const setDraft = (id, val) =>
    setNameDrafts(d => ({ ...d, [id]: val }))

  const isDirty = (u) => (nameDrafts[u.id] ?? '') !== (u.name ?? '')

  const resetDraft = (u) =>
    setNameDrafts(d => ({ ...d, [u.id]: u.name || '' }))

  const saveName = async (u) => {
    const newName = (nameDrafts[u.id] ?? '').trim()
    if (!newName) return alert('Name darf nicht leer sein.')
    setSavingId(u.id)
    try{
      await api.patch('/EditUser', { id: u.id, name: newName })
      // lokal mergen, kein Full-Reload nötig
      setUsers(arr => arr.map(x => x.id===u.id ? { ...x, name: newName } : x))
      resetDraft(u)
    }catch(e){
      alert(e.message || 'Speichern fehlgeschlagen')
    }finally{
      setSavingId(null)
    }
  }

  const inner = (
    <>
      {error && <div className="mb-3 text-red-600">{String(error)}</div>}

      <div className="grid md:grid-cols-2 gap-6">
        {/* User anlegen */}
        <form onSubmit={createUser} className="space-y-3">
          <div className="text-lg font-medium">User anlegen</div>
          <input
            value={name}
            onChange={(e)=>setName(e.target.value)}
            placeholder="Name"
            className="w-full border rounded-lg px-3 py-2"
          />
          <button type="submit" className="px-4 py-2 rounded-lg bg-emerald-600 text-white">
            Anlegen
          </button>
        </form>

        {/* Profilbild & Credits */}
        <div className="space-y-3">
          <div className="text-lg font-medium">Profilbild & Credits</div>

          <select
            value={selectedUserId || ''}
            onChange={(e)=>setSelectedUserId(Number(e.target.value) || null)}
            className="w-full border rounded-lg px-3 py-2"
          >
            <option value="">User wählen…</option>
            {users.map(u=> (
              <option key={u.id} value={u.id}>
                {u.name} (Credits: {u.credits})
              </option>
            ))}
          </select>

{selectedUser && (
  <div className="flex items-center gap-3">
    {selectedUser.profile_picture_url ? (
      <img
        src={apiBase + selectedUser.profile_picture_url}
        alt={selectedUser.name}
        className="h-12 w-12 rounded-full object-cover border"
      />
    ) : (
      <div className="h-12 w-12 rounded-full bg-gray-200 grid place-items-center text-gray-500 text-sm">
        {selectedUser.name?.slice(0,1) || '—'}
      </div>
    )}
    <div className="text-sm text-gray-600">
      <div><span className="font-medium">{selectedUser.name}</span></div>
      <div>Credits: <span className="font-medium">{selectedUser.credits}</span></div>
    </div>
  </div>
)}          <div className="flex items-center gap-2">
            <input
              type="file"
              onChange={(e)=>setFile(e.target.files?.[0]||null)}
              className="border rounded-lg px-3 py-2"
            />
            <button
              onClick={uploadPic}
              type="button"
              className="px-3 py-2 rounded-lg bg-blue-600 text-white"
              disabled={!selectedUser || !file}
            >
              Upload
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="number"
              value={creditsDelta}
              onChange={(e)=>setCreditsDelta(e.target.value)}
              className="w-32 border rounded-lg px-3 py-2"
              placeholder="z. B. 5"
            />
            <button
              onClick={()=>changeCredits(+1)}
              type="button"
              className="px-3 py-2 rounded-lg bg-emerald-600 text-white"
              disabled={!selectedUser}
            >
              + Credits
            </button>
            <button
              onClick={()=>changeCredits(-1)}
              type="button"
              className="px-3 py-2 rounded-lg bg-rose-600 text-white"
              disabled={!selectedUser}
            >
              − Credits
            </button>
          </div>
        </div>
      </div>

      {/* Liste aller User mit Umbenennen */}
      <div className="mt-6">
        <div className="text-lg font-medium mb-2">Alle User</div>
        <div className="overflow-auto">
          <table className="min-w-full border">
            <thead className="bg-gray-100">
              <tr>
                <th className="p-2 border text-left">ID</th>
                <th className="p-2 border text-left">Name</th>
                <th className="p-2 border text-left">Credits</th>
                <th className="p-2 border text-left">Bild</th>
                <th className="p-2 border text-left">Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {users.map(u => (
                <tr key={u.id} className="odd:bg-white even:bg-gray-50 align-top">
                  <td className="p-2 border">#{u.id}</td>

                  {/* Name-Edit (Draft) */}
                  <td className="p-2 border">
                    <input
                      value={nameDrafts[u.id] ?? ''}
                      onChange={e=>setDraft(u.id, e.target.value)}
                      className="border rounded-lg px-3 py-2 w-full"
                      placeholder="Name"
                    />
                    <div className="mt-1 text-xs">
                      {isDirty(u)
                        ? <span className="text-amber-700">• Nicht gespeichert</span>
                        : <span className="text-gray-500">Gespeichert</span>}
                    </div>
                  </td>

                  <td className="p-2 border">{u.credits}</td>

                  <td className="p-2 border">
                    {u.profile_picture_url
                      ? <img
                          src={apiBase + u.profile_picture_url}
                          alt={u.name}
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      : '—'}
                  </td>

                  <td className="p-2 border">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        onClick={()=>setSelectedUserId(u.id)}
                        className="px-2 py-1 rounded border"
                      >
                        Auswählen
                      </button>
                      <button
                        onClick={()=>resetDraft(u)}
                        className="px-2 py-1 rounded border"
                        disabled={!isDirty(u) || savingId===u.id}
                      >
                        Zurücksetzen
                      </button>
                      <button
                        onClick={()=>saveName(u)}
                        className="px-3 py-2 rounded-lg bg-indigo-600 text-white"
                        disabled={!isDirty(u) || savingId===u.id}
                      >
                        {savingId===u.id ? 'Speichere…' : 'Speichern'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {users.length===0 && (
                <tr>
                  <td className="p-2 border text-sm text-gray-600" colSpan={5}>
                    Keine Nutzer vorhanden.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {loading && <div className="mt-3 text-sm text-gray-500">Lade…</div>}
    </>
  )

  if (embed) return inner
  return (
    <PageShell
      title="Users"
      right={<button onClick={load} className="px-3 py-2 rounded-lg bg-gray-900 text-white">Neu laden</button>}
    >
      {inner}
    </PageShell>
  )
}
