'use client'
import { createAuthClient } from 'better-auth/react'

/** Same-origin auth client (cookies, no tokens in JavaScript). */
export const authClient = createAuthClient()
