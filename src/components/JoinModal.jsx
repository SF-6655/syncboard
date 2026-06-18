import { useState } from 'react'
import { generateGuestName } from '../lib/roomUtils'

export default function JoinModal({ onJoin, roomCode }) {
  const [name, setName] = useState('')
  const placeholder = generateGuestName()

  function handleSubmit(e) {
    e.preventDefault()
    onJoin(name.trim() || placeholder)
  }

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <div style={s.icon}>⚡</div>
        <h2 style={s.title}>Join room {roomCode}</h2>
        <p style={s.subtitle}>Pick a name others will see. You can leave it blank for a random one.</p>

        <form onSubmit={handleSubmit} style={s.form}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 20))}
            placeholder={placeholder}
            style={s.input}
          />
          <button type="submit" style={s.joinBtn}>Join board →</button>
        </form>
      </div>
    </div>
  )
}

const s = {
  overlay: {
    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    zIndex: 500, backdropFilter: 'blur(4px)',
  },
  modal: {
    background: '#16161f', border: '1px solid #2a2a3a',
    borderRadius: 16, padding: '32px 28px', width: 360,
    textAlign: 'center',
  },
  icon: { fontSize: 28, marginBottom: 8 },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 8, color: '#f0f0f5' },
  subtitle: { fontSize: 13, color: '#888', lineHeight: 1.5, marginBottom: 24 },
  form: { display: 'flex', flexDirection: 'column', gap: 12 },
  input: {
    padding: '13px 16px', background: '#0d0d16',
    border: '1px solid #2a2a3a', borderRadius: 10,
    color: '#f0f0f5', fontSize: 15, outline: 'none', textAlign: 'center',
  },
  joinBtn: {
    padding: '13px', background: '#7c6ef5', border: 'none',
    borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 700, cursor: 'pointer',
  },
}