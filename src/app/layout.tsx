import { ClerkProvider, SignInButton, SignUpButton, Show, UserButton } from '@clerk/nextjs'
import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

export const metadata: Metadata = {
  title: 'Decide — Async Decision Tracker',
  description: 'Structured proposals, stakeholder voting, permanent audit trail for remote teams.',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <ClerkProvider>
          <header className="border-b px-6 py-3 flex items-center justify-between">
            <span className="font-semibold text-lg tracking-tight">decide</span>
            <div className="flex items-center gap-3">
              <Show when="signed-out">
                <SignInButton mode="modal">
                  <button className="text-sm px-3 py-1.5 rounded-md border hover:bg-accent transition-colors">
                    Sign in
                  </button>
                </SignInButton>
                <SignUpButton mode="modal">
                  <button className="text-sm px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                    Sign up
                  </button>
                </SignUpButton>
              </Show>
              <Show when="signed-in">
                <UserButton />
              </Show>
            </div>
          </header>
          <main className="flex-1">
            {children}
          </main>
        </ClerkProvider>
      </body>
    </html>
  )
}
