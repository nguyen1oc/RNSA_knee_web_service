const configuredBase = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/$/, '')

export function apiUrl(path) {
  return `${configuredBase}${path.startsWith('/') ? path : `/${path}`}`
}

export function apiFetch(path, options = {}) {
  return fetch(apiUrl(path), { credentials: 'include', ...options })
}
