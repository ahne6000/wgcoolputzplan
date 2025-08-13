import React from 'react'

export default function PageShell({ title, children, right }){
  return (
    <div className="md:ml-64 pt-14 md:pt-6 p-4 md:p-6 min-h-screen bg-gray-50">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
        {right}
      </div>
      <div className="bg-white rounded-2xl shadow p-4">{children}</div>
    </div>
  )
}
