import React from 'react'

export function daysLeft(dueAt){
  if(!dueAt) return null
  const ms = new Date(dueAt).getTime() - Date.now()
  return ms / (1000*60*60*24)
}
export function dueGradient(dueAt){
  const d = daysLeft(dueAt)
  if(d===null) return {}
  let from = '#ffffff', to = '#ffffff'
  if(d <= 0){ from = '#fee2e2'; to = '#fecaca' }        // rot
  else if(d <= 2){ from = '#fef9c3'; to = '#fde68a' }    // gelb
  else { from = '#dcfce7'; to = '#86efac' }              // grün
  return { backgroundImage: `linear-gradient(90deg, ${from}, ${to})` }
}
export function DueBadge({ dueAt }){
  const d = daysLeft(dueAt)
  if(d===null) return null
  const label = d <= 0 ? 'fällig' : d <= 1 ? '≈1 Tag' : d <= 2 ? '≈2 Tage' : `${Math.ceil(d)}+ T.`
  const cls = d <= 0 ? 'bg-red-100 text-red-700' : d <= 2 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'
  return <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>{label}</span>
}
