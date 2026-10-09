import { deploymentEnv, routes } from '@vercel/config/v1'

const apiOrigin = deploymentEnv('KNEE_API_ORIGIN').replace(/\/$/, '')

if (!apiOrigin) {
  throw new Error(
    'Set KNEE_API_ORIGIN in both Vercel Preview and Production environments.',
  )
}

export const config = {
  rewrites: [
    routes.rewrite('/api/:path*', `${apiOrigin}/api/:path*`, {
      requestHeaders: {
        'x-knee-staging-gate': deploymentEnv('KNEE_STAGING_GATE_TOKEN'),
      },
    }),
  ],
}
