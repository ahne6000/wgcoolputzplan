import React from 'react'

export default function Modal({ open, onClose, title, children, footer }){
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="absolute inset-x-0 bottom-0 md:inset-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[520px] bg-white rounded-t-2xl md:rounded-2xl shadow-xl">
        <div className="p-4 border-b font-semibold">{title}</div>
        <div className="p-4">{children}</div>
        {footer && <div className="p-4 border-t flex justify-end gap-2">{footer}</div>}
      </div>
    </div>
  )
}
