let initialization = null
let sessionInfo = null

async function startSession() {
  const response = await fetch('/api/sessions', { method: 'POST' })
  if (!response.ok) throw new Error('Could not start a temporary workspace. Please reload and try again.')
  return response.json()
}

export async function initializeSession() {
  if (sessionInfo && Date.parse(sessionInfo.idle_expires_at) > Date.now() + 30_000) return sessionInfo
  if (initialization) return initialization
  initialization = (async () => {
    const response = await fetch('/api/sessions/current')
    sessionInfo = response.ok ? await response.json() : await startSession()
    return sessionInfo
  })()
  try {
    return await initialization
  } finally {
    initialization = null
  }
}

export async function getSessionHeaders() {
  await initializeSession()
  return {}
}

export async function clearTemporarySession() {
  await initializeSession()
  const response = await fetch('/api/sessions/current', { method: 'DELETE' })
  if (!response.ok) throw new Error('Could not clear this temporary workspace.')
  sessionInfo = null
  await initializeSession()
}
