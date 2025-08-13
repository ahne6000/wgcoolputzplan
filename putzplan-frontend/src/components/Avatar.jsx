import React from 'react'
export default function Avatar({ src, name, size=28 }){
  if (src) return <img src={src} alt={name} className="rounded-full object-cover" style={{width:size, height:size}}/>
  const initials = (name||'?').split(/\s+/).map(w=>w[0]).slice(0,2).join('').toUpperCase()
  return <div className="rounded-full bg-gray-300 flex items-center justify-center text-gray-700" style={{width:size, height:size, fontSize:size*0.4}}>{initials}</div>
}
