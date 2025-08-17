import React from 'react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine, Legend
} from 'recharts'

// Helpers
function startOfDay(d){ const x=new Date(d); x.setHours(0,0,0,0); return x }
function addDays(d,n){ const x=new Date(d); x.setDate(x.getDate()+n); return x }
function fmtDay(d){
  return d.toLocaleDateString(undefined,{ day:'2-digit', month:'2-digit' })
}
function isoWeekKey(date){
  // ISO week (Mon-Sun)
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = (d.getUTCDay() || 7)
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(),0,1))
  const weekNo = Math.ceil((((d-yearStart)/86400000)+1)/7)
  return `${d.getUTCFullYear()}-KW${String(weekNo).padStart(2,'0')}`
}
function humanWeekLabel(key){ // e.g. "2025-KW34" -> "KW34"
  const m = key.match(/KW(\d+)/); return m ? `KW${m[1]}` : key
}

export default function Stats({
  // inputs
  doneAssignments, // Array<{ task_id, done_at }>
  tasksById,       // Map<number, Task>
  expectedPerWeekPerUser, // number (float)
  mode='week',     // 'week' | 'day'
  weeks=8,
  days=14,
}){
  // build earned points series
  if (!Array.isArray(doneAssignments)) doneAssignments = []
  const now = startOfDay(new Date())

  const pointsOf = (a) => {
    const t = tasksById.get(a.task_id)
    return Number(t?.points || 0)
  }

  if (mode==='day'){
    const buckets = new Map()
    for (let i=days-1;i>=0;i--){
      const d = addDays(now, -i)
      buckets.set(d.toDateString(), { label: fmtDay(d), actual: 0 })
    }
    for (const a of doneAssignments){
      const d = a.done_at ? startOfDay(new Date(a.done_at)) : null
      if(!d) continue
      const k = d.toDateString()
      if(buckets.has(k)){
        buckets.get(k).actual += pointsOf(a)
      }
    }
    const expectedPerDay = expectedPerWeekPerUser / 7
    const data = Array.from(buckets.values())
    return (
      <div className="rounded-xl border p-3 bg-white">
        <div className="mb-2 font-medium">Punkte pro Tag (letzte {days} Tage)</div>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="label" />
              <YAxis allowDecimals={false} />
              <Tooltip />
              <Legend />
              <ReferenceLine y={expectedPerDay} strokeDasharray="4 4" label="Soll/Tag" />
              <Bar dataKey="actual" name="Ist" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    )
  }

  // weekly
  const weekKeys = []
  {
    // collect last N ISO week keys
    let cursor = addDays(now, -now.getDay()+1) // Montag dieser Woche (approx), aber isoWeekKey macht’s robust
    for (let i=weeks-1;i>=0;i--){
      const d = addDays(cursor, -7*i)
      weekKeys.push(isoWeekKey(d))
    }
  }
  const buckets = new Map(weekKeys.map(k=>[k,{ key:k, label:humanWeekLabel(k), actual:0 }]))
  for (const a of doneAssignments){
    const dt = a.done_at ? new Date(a.done_at) : null
    if(!dt) continue
    const k = isoWeekKey(dt)
    if(buckets.has(k)) buckets.get(k).actual += pointsOf(a)
  }
  const data = weekKeys.map(k=>buckets.get(k))

  return (
    <div className="rounded-xl border p-3 bg-white">
      <div className="mb-2 font-medium">Punkte pro Woche (letzte {weeks} Wochen)</div>
      <div className="h-64">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="label" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <ReferenceLine y={expectedPerWeekPerUser} strokeDasharray="4 4" label="Soll/Woche" />
            <Bar dataKey="actual" name="Ist" />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
