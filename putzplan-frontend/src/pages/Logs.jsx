import React, { useEffect, useState } from 'react'
import PageShell from '../components/PageShell'
import { useApi } from '../utils/api'

export default function Logs({ apiBase, embed=false }){
  const api = useApi(apiBase)
  const [rows, setRows] = useState([])
  const [error, setError] = useState(null)
  const [undoId, setUndoId] = useState('')

  const load = async () => { try{ setRows(await api.get('/ShowLog')) }catch(e){ setError(e.message) } }
  useEffect(()=>{ load() }, [apiBase])

  const undo = async (e) => { e.preventDefault(); const fd=new FormData(); fd.append('log_id', undoId); await fetch(apiBase + '/Reverse', { method:'POST', body: fd }); setUndoId(''); await load() }

  const inner = (
    <>
      {error && <div className="mb-3 text-red-600">{String(error)}</div>}
      <div className="overflow-auto">
        <table className="min-w-full border text-sm">
          <thead className="bg-gray-100"><tr>
            <th className="p-2 border">ID</th><th className="p-2 border">Zeit</th><th className="p-2 border">Action</th><th className="p-2 border">Actor</th><th className="p-2 border">Details</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="odd:bg-white even:bg-gray-50 align-top">
                <td className="p-2 border">{r.id}</td>
                <td className="p-2 border">{new Date(r.timestamp).toLocaleString()}</td>
                <td className="p-2 border">{r.action}</td>
                <td className="p-2 border">{r.actor_user_id ?? '—'}</td>
                <td className="p-2 border font-mono text-xs whitespace-pre-wrap">{JSON.stringify(r.details, null, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={undo} className="mt-4 flex items-center gap-2">
        <input value={undoId} onChange={(e)=>setUndoId(e.target.value)} placeholder="Log-ID für Undo" className="border rounded-lg px-3 py-2"/>
        <button type="submit" className="px-3 py-2 rounded-lg bg-rose-600 text-white">Reverse</button>
      </form>
    </>
  )

  if (embed) return inner
  return (
    <PageShell title="Logs" right={<button onClick={load} className="px-3 py-2 rounded-lg bg-gray-900 text-white">Neu laden</button>}>
      {inner}
    </PageShell>
  )
}
