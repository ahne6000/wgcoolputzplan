export const getCurrentUserId = () => {
  try {
    const v = localStorage.getItem('pp.currentUserId')
    return v ? Number(v) : null
  } catch { return null }
}

export const setCurrentUserId = (id) => {
  try { localStorage.setItem('pp.currentUserId', String(id)) } catch {}
}

export const clearCurrentUser = () => {
  try { localStorage.removeItem('pp.currentUserId') } catch {}
}
