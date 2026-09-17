import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { email } = await request.json()

  if (!email || !email.includes('@')) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
  }

  const response = await fetch(
    `https://api.resend.com/audiences/${process.env.RESEND_AUDIENCE_ID}/contacts`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ email, unsubscribed: false }),
    }
  )

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    return NextResponse.json(
      { error: errorData.message || 'Something went wrong. Please try again.' },
      { status: response.status }
    )
  }

  return NextResponse.json({ success: true })
}
