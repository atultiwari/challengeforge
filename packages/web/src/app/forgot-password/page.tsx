import Link from 'next/link'
import { ForgotPasswordForm } from '@/components/auth/ForgotPasswordForm'
import { mailer } from '@/server/mail'

export const metadata = { title: 'Forgot password' }

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-center text-3xl">Forgot your password?</h1>
      {mailer().enabled ? (
        <ForgotPasswordForm />
      ) : (
        <p className="card mx-auto max-w-md text-sm">This site cannot send email yet. Ask the site administrator to reset your password.</p>
      )}
      <p className="text-center text-sm"><Link className="underline" href="/sign-in">Back to sign in</Link></p>
    </div>
  )
}
