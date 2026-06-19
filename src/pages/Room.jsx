import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getOrCreateIdentity, updateIdentityName } from '../lib/roomUtils'
import JoinModal from '../components/JoinModal'
import { usePresence } from '../hooks/usePresence'
import { useNotes } from '../hooks/useNotes'
import { useChat } from '../hooks/useChat'
import StickyNote from '../components/StickyNote'
import { CANVAS_THEMES, getStoredTheme, setStoredTheme } from '../lib/canvasThemes'
import { useVoiceChat } from '../hooks/useVoiceChat'

function useClickOutside(ref, onOutside) {
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) {
        onOutside()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [ref, onOutside])
}

function VoiceSettingsPopover({ sensitivity, setSensitivity, micLevel, outputVolume, setOutputVolume, onClose }) {
  const ref = useRef(null)
  useClickOutside(ref, onClose)
  const thresholdMarkerPercent = Math.max(4, Math.min(96, 50 - sensitivity / 2.2))

  return (
    <div ref={ref} style={s.popover}>
      <div style={s.popoverHeader}>Voice settings</div>
      <div style={s.popoverSection}>
        <div style={s.popoverLabelRow}>
          <span style={s.popoverLabel}>Mic sensitivity</span>
          <span style={s.popoverValue}>{sensitivity === 0 ? 'Auto' : sensitivity > 0 ? `+${sensitivity}` : sensitivity}</span>
        </div>
        <div style={s.meterTrack}>
          <div style={{ ...s.meterFill, width: `${Math.round(micLevel * 100)}%` }} />
          <div style={{ ...s.meterThreshold, left: `${thresholdMarkerPercent}%` }} />
        </div>
        <input
          type="range" min={-100} max={100} value={sensitivity}
          onChange={(e) => setSensitivity(Number(e.target.value))}
          style={s.slider}
        />
        <div style={s.sliderHints}>
          <span>Opens easily</span>
          <span>Needs more volume</span>
        </div>
      </div>
      <div style={s.popoverSection}>
        <div style={s.popoverLabelRow}>
          <span style={s.popoverLabel}>Output volume</span>
          <span style={s.popoverValue}>{outputVolume}%</span>
        </div>
        <input
          type="range" min={0} max={200} value={outputVolume}
          onChange={(e) => setOutputVolume(Number(e.target.value))}
          style={s.slider}
        />
      </div>
    </div>
  )
}

function UserVolumePopover({ name, gain, onChange, onClose }) {
  const ref = useRef(null)
  useClickOutside(ref, onClose)

  return (
    <div ref={ref} style={s.userPopover}>
      <div style={s.popoverLabelRow}>
        <span style={s.popoverLabel}>{name}'s volume</span>
        <span style={s.popoverValue}>{gain}%</span>
      </div>
      <input
        type="range" min={0} max={200} value={gain}
        onChange={(e) => onChange(Number(e.target.value))}
        style={s.slider}
      />
    </div>
  )
}

export default function Room() {
  const { code } = useParams()
  const navigate = useNavigate()
  const [identity, setIdentity] = useState(null)
  const [roomId, setRoomId] = useState(null)
  const [roomExists, setRoomExists] = useState(null)
  const [copied, setCopied] = useState(false)
  const [liveDragPositions, setLiveDragPositions] = useState({})
  const [chatInput, setChatInput] = useState('')
  const [showChat, setShowChat] = useState(true)
  const [hasJoined, setHasJoined] = useState(() =>
    sessionStorage.getItem(`joined-${code}`) === 'true'
  )
  const [themeKey, setThemeKey] = useState(getStoredTheme())
  const [isHost, setIsHost] = useState(false)
  const [expired, setExpired] = useState(false)
  const [showVoiceSettings, setShowVoiceSettings] = useState(false)
  const [openUserVolumeId, setOpenUserVolumeId] = useState(null)
  const theme = CANVAS_THEMES[themeKey]

  function handleThemeChange(key) {
    setThemeKey(key)
    setStoredTheme(key)
  }

  useEffect(() => {
    setIdentity(getOrCreateIdentity())
  }, [])

  function handleJoin(chosenName) {
    const updated = updateIdentityName(chosenName)
    setIdentity(updated)
    sessionStorage.setItem(`joined-${code}`, 'true')
    setHasJoined(true)
  }

  useEffect(() => {
    async function checkRoom() {
      const { data } = await supabase
        .from('rooms')
        .select('id, host_id, created_at')
        .eq('code', code)
        .maybeSingle()

      if (!data) {
        setRoomExists(false)
        return
      }

      const ageHours = (Date.now() - new Date(data.created_at).getTime()) / (1000 * 60 * 60)
      if (ageHours > 24) {
        setExpired(true)
        setRoomExists(false)
        return
      }

      setRoomExists(true)
      setRoomId(data.id)

      const myIdentity = getOrCreateIdentity()
      setIsHost(data.host_id === myIdentity.id)
    }
    checkRoom()
  }, [code])

  const { onlineUsers, channel } = usePresence(code, identity)
  const {
    inVoice, muted, voiceUsers, joinVoice, leaveVoice, toggleMute,
    sensitivity, setSensitivity, micLevel,
    outputVolume, setOutputVolume, userOutputGains, setUserOutputGain,
  } = useVoiceChat(channel, identity)
  const { notes, addNote, updateNote, deleteNote } = useNotes(code, roomId)
  const { messages, sendMessage } = useChat(code, roomId)

  useEffect(() => {
    if (!channel) return
    channel.on('broadcast', { event: 'note-drag' }, (payload) => {
      const { noteId, x, y } = payload.payload
      setLiveDragPositions((prev) => {
        const current = prev[noteId]
        if (current && current.x === x && current.y === y) return prev
        return { ...prev, [noteId]: { x, y } }
      })
    })
  }, [channel])

  const handleDragBroadcast = useCallback((noteId, x, y) => {
    if (channel) {
      channel.send({ type: 'broadcast', event: 'note-drag', payload: { noteId, x, y } })
    }
  }, [channel])

  const handleUpdate = useCallback((id, updates) => {
    updateNote(id, updates)
    if (updates.x !== undefined || updates.y !== undefined) {
      setLiveDragPositions((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }
        delete next[id]
        return next
      })
    }
  }, [updateNote])

  function copyCode() {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function handleLeaveRoom() {
    sessionStorage.removeItem(`joined-${code}`)
    navigate('/', { replace: true })
  }

  async function handleCloseRoom() {
    const confirmed = window.confirm('Close this room for everyone? This deletes all notes and chat history permanently.')
    if (!confirmed) return
    sessionStorage.removeItem(`joined-${code}`)
    await supabase.from('rooms').delete().eq('id', roomId)
    navigate('/', { replace: true })
  }

  function handleSendChat(e) {
    e.preventDefault()
    if (!chatInput.trim() || !identity) return
    sendMessage(chatInput, identity.name, identity.color)
    setChatInput('')
  }

  if (roomExists === false) {
    return (
      <div style={s.notFound}>
        <p>{expired ? 'This room has expired (rooms last 24 hours).' : 'Room not found.'}</p>
        <button onClick={() => { sessionStorage.removeItem(`joined-${code}`); navigate('/', { replace: true }) }} style={s.backBtn}>
          ← Back home
        </button>
      </div>
    )
  }

  if (roomExists === null || !identity) {
    return <div style={s.loading}>Connecting...</div>
  }

  if (!hasJoined) {
    return <JoinModal roomCode={code} onJoin={handleJoin} />
  }

  return (
    <div style={{ ...s.page, background: theme.bg }}>
      <div style={{ ...s.header, borderBottomColor: theme.border }}>
        <div style={s.headerLeft}>
          <span style={s.logo}>⚡ SyncBoard</span>
          <button onClick={copyCode} style={s.codeBadge}>
            {copied ? '✓ Copied' : `Room: ${code}`}
          </button>
        </div>

        <div style={s.headerRight}>
          <div style={s.userList}>
            {onlineUsers.map((user) => {
              const speaking = voiceUsers.find((v) => v.id === user.id)
              const isSelf = user.id === identity.id
              const gain = userOutputGains[user.id] ?? 100
              return (
                <div key={user.id} style={s.userPillWrap}>
                  <button
                    onClick={() => !isSelf && inVoice && setOpenUserVolumeId(openUserVolumeId === user.id ? null : user.id)}
                    style={{
                      ...s.userPill,
                      border: speaking?.speaking ? '1px solid #4ade80' : '1px solid #2a2a3a',
                      cursor: !isSelf && inVoice ? 'pointer' : 'default',
                    }}
                    title={!isSelf && inVoice ? `Adjust ${user.name}'s volume` : undefined}
                  >
                    <div style={{ ...s.userDot, background: user.color }} />
                    <span>{user.name}</span>
                    {speaking?.speaking && <span style={s.voiceIcon}>🎙️</span>}
                    {!isSelf && inVoice && gain !== 100 && <span style={s.gainBadge}>{gain}%</span>}
                  </button>
                  {openUserVolumeId === user.id && (
                    <UserVolumePopover
                      name={user.name}
                      gain={gain}
                      onChange={(val) => setUserOutputGain(user.id, val)}
                      onClose={() => setOpenUserVolumeId(null)}
                    />
                  )}
                </div>
              )
            })}
          </div>

          <select
            value={themeKey}
            onChange={(e) => handleThemeChange(e.target.value)}
            style={{ ...s.themeSelect, borderColor: theme.border }}
          >
            {Object.entries(CANVAS_THEMES).map(([key, t]) => (
              <option key={key} value={key}>{t.name}</option>
            ))}
          </select>

          {!inVoice ? (
            <button onClick={joinVoice} style={s.voiceJoinBtn}>🎙️ Join voice</button>
          ) : (
            <div style={s.voiceControls}>
              <button onClick={toggleMute} style={{ ...s.voiceMuteBtn, background: muted ? '#3a1a1a' : '#1a3a2a' }}>
                {muted ? '🔇 Unmute' : '🎙️ Mute'}
              </button>
              <div style={s.voiceSettingsWrap}>
                <button onClick={() => setShowVoiceSettings(!showVoiceSettings)} style={s.voiceSettingsBtn} title="Voice settings">
                  ⚙️
                </button>
                {showVoiceSettings && (
                  <VoiceSettingsPopover
                    sensitivity={sensitivity}
                    setSensitivity={setSensitivity}
                    micLevel={micLevel}
                    outputVolume={outputVolume}
                    setOutputVolume={setOutputVolume}
                    onClose={() => setShowVoiceSettings(false)}
                  />
                )}
              </div>
              <button onClick={leaveVoice} style={s.voiceLeaveBtn}>Leave voice</button>
            </div>
          )}

          <button onClick={() => setShowChat(!showChat)} style={s.chatToggleBtn}>
            💬 {showChat ? 'Hide chat' : 'Show chat'}
          </button>
          <button onClick={() => addNote(identity.name)} style={s.addBtn}>+ Add note</button>
          {isHost ? (
            <button onClick={handleCloseRoom} style={s.closeRoomBtn}>🔒 Close room</button>
          ) : (
            <button onClick={handleLeaveRoom} style={s.leaveBtn}>← Leave</button>
          )}
        </div>
      </div>

      <div style={s.body}>
        <div style={{ ...s.canvas, background: theme.canvasBg }}>
          {notes.length === 0 && (
            <p style={s.emptyHint}>No notes yet — click "+ Add note" to start.</p>
          )}
          {notes.map((note) => (
            <StickyNote
              key={note.id}
              note={{
                ...note,
                liveX: liveDragPositions[note.id]?.x,
                liveY: liveDragPositions[note.id]?.y,
              }}
              onUpdate={handleUpdate}
              onDelete={deleteNote}
              onDragBroadcast={handleDragBroadcast}
            />
          ))}
        </div>

        {showChat && (
          <div style={{ ...s.chatPanel, background: theme.panelBg, borderLeftColor: theme.border }}>
            <div style={s.chatHeader}>Live chat</div>
            <div style={s.chatMessages}>
              {messages.length === 0 && (
                <p style={s.chatEmpty}>No messages yet. Say hi!</p>
              )}
              {messages.map((msg) => (
                <div key={msg.id} style={s.chatMessage}>
                  <span style={{ ...s.chatAuthor, color: msg.author_color }}>{msg.author_name}</span>
                  <p style={s.chatText}>{msg.text}</p>
                </div>
              ))}
            </div>
            <form onSubmit={handleSendChat} style={s.chatForm}>
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..."
                style={s.chatInput}
              />
              <button type="submit" style={s.chatSendBtn}>→</button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  leaveBtn: {
    background: 'transparent', border: '1px solid #2a2a3a', borderRadius: 8,
    color: '#aaa', padding: '8px 14px', fontSize: 13, cursor: 'pointer',
  },
  closeRoomBtn: {
    background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8,
    color: '#f87171', padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
  },
  page: { height: '100vh', display: 'flex', flexDirection: 'column' },
  header: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '14px 24px', borderBottom: '1px solid', flexWrap: 'wrap', gap: 10,
  },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 16 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 12 },
  logo: { fontSize: 16, fontWeight: 700, color: '#7c6ef5' },
  codeBadge: {
    background: '#16161f', border: '1px solid #2a2a3a',
    borderRadius: 8, padding: '6px 14px', color: '#aaa',
    fontSize: 13, cursor: 'pointer', fontWeight: 600,
  },
  userList: { display: 'flex', gap: 8 },
  userPillWrap: { position: 'relative' },
  userPill: {
    display: 'flex', alignItems: 'center', gap: 6,
    background: '#16161f', border: '1px solid #2a2a3a',
    borderRadius: 20, padding: '5px 12px', fontSize: 12, color: '#ccc',
    font: 'inherit',
  },
  userDot: { width: 7, height: 7, borderRadius: '50%' },
  gainBadge: {
    fontSize: 10, color: '#7c6ef5', background: '#1f1a3a',
    borderRadius: 8, padding: '1px 6px', marginLeft: 2, fontWeight: 700,
  },
  themeSelect: {
    background: '#16161f', border: '1px solid #2a2a3a', borderRadius: 8,
    color: '#aaa', padding: '8px 12px', fontSize: 13, cursor: 'pointer', outline: 'none',
  },
  voiceJoinBtn: {
    background: '#1a3a2a', border: '1px solid #2a5a3a', borderRadius: 8,
    color: '#4ade80', padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
  },
  voiceControls: { display: 'flex', gap: 6, alignItems: 'center' },
  voiceMuteBtn: {
    border: '1px solid #2a5a3a', borderRadius: 8,
    color: '#fff', padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
  },
  voiceLeaveBtn: {
    background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8,
    color: '#f87171', padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontWeight: 600,
  },
  voiceIcon: { fontSize: 10, marginLeft: 2 },
  voiceSettingsWrap: { position: 'relative', display: 'flex' },
  voiceSettingsBtn: {
    background: '#16161f', border: '1px solid #2a2a3a', borderRadius: 8,
    color: '#ccc', padding: '8px 10px', fontSize: 13, cursor: 'pointer',
  },
  chatToggleBtn: {
    background: 'transparent', border: '1px solid #2a2a3a', borderRadius: 8,
    color: '#aaa', padding: '8px 14px', fontSize: 13, cursor: 'pointer',
  },
  addBtn: {
    background: '#7c6ef5', border: 'none', borderRadius: 8,
    color: '#fff', padding: '8px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer',
  },
  body: { flex: 1, display: 'flex', overflow: 'hidden' },
  canvas: {
    flex: 1, position: 'relative', overflow: 'hidden',
    backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)',
    backgroundSize: '24px 24px',
  },
  emptyHint: {
    position: 'absolute', top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)', color: '#444', fontSize: 14,
  },
  chatPanel: {
    width: 280, borderLeft: '1px solid', display: 'flex', flexDirection: 'column',
  },
  chatHeader: {
    padding: '12px 16px', fontSize: 13, fontWeight: 600,
    color: '#888', borderBottom: '1px solid #1a1a2a',
  },
  chatMessages: { flex: 1, overflowY: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 12 },
  chatEmpty: { color: '#444', fontSize: 13, textAlign: 'center', marginTop: 20 },
  chatMessage: {},
  chatAuthor: { fontSize: 12, fontWeight: 700 },
  chatText: { fontSize: 13, color: '#ccc', marginTop: 2, lineHeight: 1.4 },
  chatForm: { display: 'flex', padding: 12, gap: 8, borderTop: '1px solid #1a1a2a' },
  chatInput: {
    flex: 1, background: '#16161f', border: '1px solid #2a2a3a',
    borderRadius: 8, padding: '8px 12px', color: '#f0f0f5', fontSize: 13, outline: 'none',
  },
  chatSendBtn: {
    background: '#7c6ef5', border: 'none', borderRadius: 8,
    color: '#fff', width: 36, cursor: 'pointer', fontSize: 14,
  },
  loading: {
    height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: '#555', background: '#0a0a12',
  },
  notFound: {
    height: '100vh', display: 'flex', flexDirection: 'column', gap: 16,
    alignItems: 'center', justifyContent: 'center', color: '#888', background: '#0a0a12',
  },
  backBtn: {
    background: '#7c6ef5', border: 'none', borderRadius: 8,
    color: '#fff', padding: '10px 20px', cursor: 'pointer', fontSize: 14,
  },
  popover: {
    position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 50,
    width: 260, background: '#16161f', border: '1px solid #2a2a3a',
    borderRadius: 12, padding: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
  popoverHeader: { fontSize: 13, fontWeight: 700, color: '#f0f0f5', marginBottom: 12 },
  popoverSection: { marginBottom: 14 },
  popoverLabelRow: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6,
  },
  popoverLabel: { fontSize: 12, color: '#aaa', fontWeight: 600 },
  popoverValue: { fontSize: 12, color: '#7c6ef5', fontWeight: 700 },
  meterTrack: {
    position: 'relative', height: 8, background: '#0a0a12',
    borderRadius: 4, marginBottom: 8, overflow: 'visible',
  },
  meterFill: { height: '100%', background: '#4ade80', borderRadius: 4, transition: 'width 60ms linear' },
  meterThreshold: { position: 'absolute', top: -3, bottom: -3, width: 2, background: '#f0f0f5', borderRadius: 1 },
  slider: { width: '100%', cursor: 'pointer', accentColor: '#7c6ef5' },
  sliderHints: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555', marginTop: 4 },
  userPopover: {
    position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 50,
    width: 200, background: '#16161f', border: '1px solid #2a2a3a',
    borderRadius: 12, padding: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
  },
}