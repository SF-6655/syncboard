import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { generateRoomCode, getOrCreateIdentity } from '../lib/roomUtils'

export default function Landing() {
  const navigate = useNavigate()
  const [joinCode, setJoinCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleCreateRoom() {
    setLoading(true)
    setError('')

    let code = generateRoomCode()
    let attempts = 0

    // Ensure uniqueness, retry if collision (rare with 6 chars)
    while (attempts < 5) {
      const { data: existing } = await supabase
        .from('rooms')
        .select('id')
        .eq('code', code)
        .maybeSingle()

      if (!existing) break
      code = generateRoomCode()
      attempts++
    }

const identity = getOrCreateIdentity()
const { error: insertError } = await supabase
  .from('rooms')
  .insert({ code, host_id: identity.id })

    if (insertError) {
      setError('Could not create room. Try again.')
      setLoading(false)
      return
    }

    navigate(`/room/${code}`, { replace: true })
  }

  async function handleJoinRoom(e) {
    e.preventDefault()
    if (!joinCode.trim()) return
    setLoading(true)
    setError('')

    const code = joinCode.trim().toUpperCase()

    const { data, error: fetchError } = await supabase
      .from('rooms')
      .select('id')
      .eq('code', code)
      .maybeSingle()

    if (fetchError || !data) {
      setError('Room not found. Check the code and try again.')
      setLoading(false)
      return
    }

    navigate(`/room/${code}`, { replace: true })
  }

  return (
    <div style={s.page}>
      <div style={s.hero}>
        <h1 style={s.title}>⚡ SyncBoard</h1>
        <p style={s.subtitle}>Real-time collaborative sticky notes.<br />No sign-up. Just share a code.</p>

        {error && <div style={s.error}>{error}</div>}

        <button onClick={handleCreateRoom} disabled={loading} style={{ ...s.createBtn, opacity: loading ? 0.6 : 1 }}>
          {loading ? 'Creating...' : '+ Create new room'}
        </button>

        <div style={s.divider}>
          <span style={s.dividerText}>or join existing</span>
        </div>

        <form onSubmit={handleJoinRoom} style={s.joinForm}>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ENTER CODE"
            maxLength={6}
            style={s.codeInput}
          />
          <button type="submit" disabled={loading} style={{ ...s.joinBtn, opacity: loading ? 0.6 : 1 }}>
            Join →
          </button>
        </form>
      </div>
    </div>
  )
}

const s = {
  page: {
    minHeight: '100vh', display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    background: '#0a0a12', padding: 24,
  },
  hero: {
    maxWidth: 440, width: '100%', textAlign: 'center',
  },
  title: { fontSize: 36, fontWeight: 800, marginBottom: 12, letterSpacing: -1 },
  subtitle: { fontSize: 15, color: '#888', lineHeight: 1.6, marginBottom: 36 },
  error: {
    background: '#2a1a1a', border: '1px solid #5a2a2a',
    borderRadius: 8, padding: '10px 14px', fontSize: 13,
    color: '#f87171', marginBottom: 20,
  },
  createBtn: {
    width: '100%', padding: '16px', background: '#7c6ef5',
    border: 'none', borderRadius: 12, color: '#fff',
    fontSize: 16, fontWeight: 700, cursor: 'pointer',
  },
  divider: {
    display: 'flex', alignItems: 'center', margin: '28px 0',
    color: '#444', fontSize: 12,
  },
  dividerText: { margin: '0 auto' },
  joinForm: { display: 'flex', gap: 10 },
  codeInput: {
    flex: 1, padding: '14px 16px', background: '#16161f',
    border: '1px solid #2a2a3a', borderRadius: 10,
    color: '#f0f0f5', fontSize: 18, textAlign: 'center',
    letterSpacing: 4, fontWeight: 700, outline: 'none',
  },
  joinBtn: {
    padding: '14px 24px', background: 'transparent',
    border: '1px solid #2a2a3a', borderRadius: 10,
    color: '#aaa', fontSize: 15, fontWeight: 600, cursor: 'pointer',
  },
}