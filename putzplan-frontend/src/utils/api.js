import { useMemo } from 'react'

export const getDefaultApiBase = () => (window).__API_BASE__ ?? '/api'

export function useApi(apiBase){
  const jsonHeaders = useMemo(() => ({ 'Content-Type': 'application/json' }), [])
  const get = async (path) => {
    const res = await fetch(apiBase + path)
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }
  const post = async (path, body) => {
    const res = await fetch(apiBase + path, { method: 'POST', headers: jsonHeaders, body: JSON.stringify(body) })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }
  const postForm = async (path, formData) => {
    const res = await fetch(apiBase + path, { method: 'POST', body: formData })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }
  const patch = async (path, body) => {
    const res = await fetch(apiBase + path, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify(body) })
    if (!res.ok) throw new Error(await res.text())
    return res.json()
  }
  return { get, post, postForm, patch }
}
