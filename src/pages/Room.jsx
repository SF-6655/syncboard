import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getOrCreateIdentity } from '../lib/roomUtils'
import JoinModal from '../components/JoinModal'
import { usePresence } from '../hooks/usePresence'
import { useNotes } from '../hooks/useNotes'
import { useChat } from '../hooks/useChat'
import { useWhiteboard } from '../hooks/useWhiteboard'
import StickyNote from '../components/StickyNote'
import Whiteboard from '../components/Whiteboard'
import { CANVAS_THEMES, getStoredTheme, setStoredTheme } from '../lib/canvasThemes'
import { useVoiceChat } from '../hooks/useVoiceChat'

function useClickOutside(ref, onOutside) {
  useEffect(() => {
    function handleClick(e) {
      if (ref.current && !ref.current.contains(e.target)) onOutside()
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [ref, onOutside])
}

function VoiceSettingsPopover({
  sensitivity, setSensitivity, micLevel,
  outputVolume, setOutputVolume,
  audioDevices, selectedInput, setSelectedInput,
  selectedOutput, setSelectedOutput,
  onClose,
}) {
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
        <input type="range" min={-100} max={100} value={sensitivity}
          onChange={(e) => setSensitivity(Number(e.target.value))} style={s.slider} />
        <div style={s.sliderHints}><span>Opens easily</span><span>Needs more volume</span></div>
      </div>
      <div style={s.popoverSection}>
        <div style={s.popoverLabelRow}>
          <span style={s.popoverLabel}>Output volume</span>
          <span style={s.popoverValue}>{outputVolume}%</span>
        </div>
        <input type="range" min={0} max={200} value={outputVolume}
          onChange={(e) => setOutputVolume(Number(e.target.value))} style={s.slider} />
      </div>
      {audioDevices.inputs.length > 0 && (
        <div style={s.popoverSection}>
          <div style={s.popoverLabelRow}><span style={s.popoverLabel}>Microphone</span></div>
          <select value={selectedInput} onChange={(e) => setSelectedInput(e.target.value)} style={s.deviceSelect}>
            {audioDevices.inputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Microphone ${d.deviceId.slice(0, 6)}`}</option>
            ))}
          </select>
        </div>
      )}
      {audioDevices.outputs.length > 0 && (
        <div style={s.popoverSection}>
          <div style={s.popoverLabelRow}><span style={s.popoverLabel}>Speaker / headphones</span></div>
          <select value={selectedOutput} onChange={(e) => setSelectedOutput(e.target.value)} style={s.deviceSelect}>
            {audioDevices.outputs.map(d => (
              <option key={d.deviceId} value={d.deviceId}>{d.label || `Speaker ${d.deviceId.slice(0, 6)}`}</option>
            ))}
          </select>
        </div>
      )}
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
      <input type="range" min={0} max={200} value={gain}
        onChange={(e) => onChange(Number(e.target.value))} style={s.slider} />
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
  const [activeTab, setActiveTab] = useState('board') // 'board' | 'whiteboard'
  const [hasJoined, setHasJoined] = useState(() =>
    sessionStorage.getItem(`joined-${code}`) === 'true'
  )
  const [themeKey, setThemeKey] = useState(getStoredTheme())
  const [isHost, setIsHost] = useState(false)
  const [expired, setExpired] = useState(false)
  const [showVoiceSettings, setShowVoiceSettings] = useState(false)
  const [openUserVolumeId, setOpenUserVolumeId] = useState(null)
  const theme = CANVAS_THEMES[themeKey]

  function handleThemeChange(key) { setThemeKey(key); setStoredTheme(key) }

  function handleJoin(chosenName) {
    const base = getOrCreateIdentity()
    const updated = { ...base, name: chosenName.trim().slice(0, 20) || base.name }
    sessionStorage.setItem('syncboard-identity', JSON.stringify(updated))
    sessionStorage.setItem(`joined-${code}`, 'true')
    setIdentity(updated)
    setHasJoined(true)
  }

  useEffect(() => {
    async function checkRoom() {
      const { data } = await supabase
        .from('rooms').select('id, host_id, created_at').eq('code', code).maybeSingle()
      if (!data) { setRoomExists(false); return }
      const ageHours = (Date.now() - new Date(data.created_at).getTime()) / (1000 * 60 * 60)
      if (ageHours > 24) { setExpired(true); setRoomExists(false); return }
      setRoomExists(true)
      setRoomId(data.id)
      setIsHost(data.host_id === getOrCreateIdentity().id)
    }
    checkRoom()
  }, [code])

  const { onlineUsers, channel } = usePresence(code, identity)
  const {
    inVoice, muted, voiceUsers, joinVoice, leaveVoice, toggleMute,
    sensitivity, setSensitivity, micLevel,
    outputVolume, setOutputVolume, userOutputGains, setUserOutputGain,
    audioDevices, selectedInput, setSelectedInput, selectedOutput, setSelectedOutput,
  } = useVoiceChat(channel, identity)
  const { notes, addNote, updateNote, deleteNote } = useNotes(code, roomId)
  const { messages, sendMessage } = useChat(code, roomId)
  const { strokes, saveStroke, clearBoard } = useWhiteboard(roomId, channel)

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
    if (channel) channel.send({ type: 'broadcast', event: 'note-drag', payload: { noteId, x, y } })
  }, [channel])

  const handleUpdate = useCallback((id, updates) => {
    updateNote(id, updates)
    if (updates.x !== undefined || updates.y !== undefined) {
      setLiveDragPositions((prev) => {
        if (!(id in prev)) return prev
        const next = { ...prev }; delete next[id]; return next
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

  if (roomExists === null) return <div style={s.loading}>Connecting...</div>
  if (!hasJoined) return <JoinModal roomCode={code} onJoin={handleJoin} />
  if (!identity) return <div style={s.loading}>Connecting...</div>

  return (
    <div style={{ ...s.page, background: theme.bg }}>
      {/* Header */}
      <div style={{ ...s.header, borderBottomColor: theme.border }}>
        <div style={s.headerLeft}>
          <span style={s.logo}>⚡ SyncBoard</span>
          <button onClick={copyCode} style={s.codeBadge}>
            {copied ? '✓ Copied' : `Room: ${code}`}
          </button>
          <div style={s.tabs}>
            <button onClick={() => setActiveTab('board')} style={{ ...s.tab, background: activeTab === 'board' ? '#7c6ef5' : 'transparent', color: activeTab === 'board' ? '#fff' : '#888', border: `1px solid ${activeTab === 'board' ? '#7c6ef5' : '#2a2a3a'}` }}>
              📌 Board
            </button>
            <button onClick={() => setActiveTab('whiteboard')} style={{ ...s.tab, background: activeTab === 'whiteboard' ? '#7c6ef5' : 'transparent', color: activeTab === 'whiteboard' ? '#fff' : '#888', border: `1px solid ${activeTab === 'whiteboard' ? '#7c6ef5' : '#2a2a3a'}` }}>
              🎨 Whiteboard
            </button>
          </div>
        </div>

        <div style={s.headerRight}>
          <select value={themeKey} onChange={(e) => handleThemeChange(e.target.value)}
            style={{ ...s.themeSelect, borderColor: theme.border }}>
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
                <button onClick={() => setShowVoiceSettings(!showVoiceSettings)} style={s.voiceSettingsBtn} title="Voice settings">⚙️</button>
                {showVoiceSettings && (
                  <VoiceSettingsPopover
                    sensitivity={sensitivity} setSensitivity={setSensitivity} micLevel={micLevel}
                    outputVolume={outputVolume} setOutputVolume={setOutputVolume}
                    audioDevices={audioDevices} selectedInput={selectedInput} setSelectedInput={setSelectedInput}
                    selectedOutput={selectedOutput} setSelectedOutput={setSelectedOutput}
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
          {activeTab === 'board' && (
            <button onClick={() => addNote(identity.name)} style={s.addBtn}>+ Add note</button>
          )}
          {isHost ? (
            <button onClick={handleCloseRoom} style={s.closeRoomBtn}>🔒 Close room</button>
          ) : (
            <button onClick={handleLeaveRoom} style={s.leaveBtn}>← Leave</button>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={s.body}>
        {/* Left sidebar — participants */}
        <div style={{ ...s.sidebar, borderRightColor: theme.border }}>
          <div style={s.sidebarHeader}>Participants</div>
          <div style={s.sidebarList}>
            {onlineUsers.map((user) => {
              const voiceUser = voiceUsers.find((v) => v.id === user.id)
              const isSelf = user.id === identity.id
              const gain = userOutputGains[user.id] ?? 100
              return (
                <div key={user.id} style={s.participantWrap}>
                  <button
                    onClick={() => !isSelf && inVoice && setOpenUserVolumeId(openUserVolumeId === user.id ? null : user.id)}
                    style={{
                      ...s.participantRow,
                      background: voiceUser?.speaking ? 'rgba(74,222,128,0.08)' : 'transparent',
                      border: `1px solid ${voiceUser?.speaking ? '#4ade80' : 'transparent'}`,
                      cursor: !isSelf && inVoice ? 'pointer' : 'default',
                    }}
                  >
                    <div style={{ ...s.participantDot, background: user.color }} />
                    <span style={s.participantName}>{user.name}{isSelf ? ' (you)' : ''}</span>
                    <div style={s.participantIcons}>
                      {voiceUser && (
                        <span style={{ fontSize: 12, color: voiceUser.speaking ? '#4ade80' : '#555' }}>
                          {voiceUser.speaking ? '🔊' : '🔈'}
                        </span>
                      )}
                      {!isSelf && inVoice && gain !== 100 && (
                        <span style={s.gainBadge}>{gain}%</span>
                      )}
                    </div>
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
        </div>

        {/* Main area */}
        <div style={s.main}>
          {activeTab === 'board' ? (
            <div style={{ ...s.boardCanvas, background: theme.canvasBg }}>
              {notes.length === 0 && (
                <p style={s.emptyHint}>No notes yet — click "+ Add note" to start.</p>
              )}
              {notes.map((note) => (
                <StickyNote
                  key={note.id}
                  note={{ ...note, liveX: liveDragPositions[note.id]?.x, liveY: liveDragPositions[note.id]?.y }}
                  onUpdate={handleUpdate}
                  onDelete={deleteNote}
                  onDragBroadcast={handleDragBroadcast}
                />
              ))}
            </div>
          ) : (
            <Whiteboard
              strokes={strokes}
              onStrokeComplete={saveStroke}
              onClear={clearBoard}
              channel={channel}
              identity={identity}
            />
          )}
        </div>

        {/* Right chat panel */}
        {showChat && (
          <div style={{ ...s.chatPanel, background: theme.panelBg, borderLeftColor: theme.border }}>
            <div style={s.chatHeader}>Live chat</div>
            <div style={s.chatMessages}>
              {messages.length === 0 && <p style={s.chatEmpty}>No messages yet. Say hi!</p>}
              {messages.map((msg) => (
                <div key={msg.id} style={s.chatMessage}>
                  <span style={{ ...s.chatAuthor, color: msg.author_color }}>{msg.author_name}</span>
                  <p style={s.chatText}>{msg.text}</p>
                </div>
              ))}
            </div>
            <form onSubmit={handleSendChat} style={s.chatForm}>
              <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                placeholder="Type a message..." style={s.chatInput} />
              <button type="submit" style={s.chatSendBtn}>→</button>
            </form>
          </div>
        )}
      </div>
    </div>
  )
}

const s = {
  page: { height: '100vh', display: 'flex', flexDirection: 'column' },
  header: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 20px', borderBottom: '1px solid', flexWrap: 'wrap', gap: 10, flexShrink: 0 },
  headerLeft: { display: 'flex', alignItems: 'center', gap: 12 },
  headerRight: { display: 'flex', alignItems: 'center', gap: 10 },
  logo: { fontSize: 15, fontWeight: 700, color: '#7c6ef5' },
  codeBadge: { background: '#16161f', border: '1px solid #2a2a3a', borderRadius: 8, padding: '5px 12px', color: '#aaa', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  tabs: { display: 'flex', gap: 6 },
  tab: { borderRadius: 8, padding: '5px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  themeSelect: { background: '#16161f', border: '1px solid #2a2a3a', borderRadius: 8, color: '#aaa', padding: '6px 10px', fontSize: 12, cursor: 'pointer', outline: 'none' },
  voiceJoinBtn: { background: '#1a3a2a', border: '1px solid #2a5a3a', borderRadius: 8, color: '#4ade80', padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  voiceControls: { display: 'flex', gap: 6, alignItems: 'center' },
  voiceMuteBtn: { border: '1px solid #2a5a3a', borderRadius: 8, color: '#fff', padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  voiceLeaveBtn: { background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, color: '#f87171', padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  voiceSettingsWrap: { position: 'relative', display: 'flex' },
  voiceSettingsBtn: { background: '#16161f', border: '1px solid #2a2a3a', borderRadius: 8, color: '#ccc', padding: '6px 8px', fontSize: 12, cursor: 'pointer' },
  chatToggleBtn: { background: 'transparent', border: '1px solid #2a2a3a', borderRadius: 8, color: '#aaa', padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  addBtn: { background: '#7c6ef5', border: 'none', borderRadius: 8, color: '#fff', padding: '6px 14px', fontSize: 12, fontWeight: 600, cursor: 'pointer' },
  closeRoomBtn: { background: '#3a1a1a', border: '1px solid #5a2a2a', borderRadius: 8, color: '#f87171', padding: '6px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 600 },
  leaveBtn: { background: 'transparent', border: '1px solid #2a2a3a', borderRadius: 8, color: '#aaa', padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  body: { flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 },

  // Left sidebar
  sidebar: { width: 180, flexShrink: 0, borderRight: '1px solid', display: 'flex', flexDirection: 'column', overflow: 'hidden' },
  sidebarHeader: { padding: '10px 14px', fontSize: 11, fontWeight: 700, color: '#555', textTransform: 'uppercase', letterSpacing: 1, borderBottom: '1px solid #1a1a2a', flexShrink: 0 },
  sidebarList: { flex: 1, overflowY: 'auto', padding: '8px 0' },
  participantWrap: { position: 'relative' },
  participantRow: { width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 14px', borderRadius: 0, font: 'inherit', cursor: 'default', transition: 'background 0.15s' },
  participantDot: { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  participantName: { flex: 1, fontSize: 12, color: '#ccc', textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  participantIcons: { display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 },
  gainBadge: { fontSize: 9, color: '#7c6ef5', background: '#1f1a3a', borderRadius: 6, padding: '1px 5px', fontWeight: 700 },

  // Main content
  main: { flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 },
  boardCanvas: { flex: 1, position: 'relative', overflow: 'hidden', backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.08) 1px, transparent 1px)', backgroundSize: '24px 24px' },
  emptyHint: { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', color: '#444', fontSize: 14 },

  // Chat
  chatPanel: { width: 260, borderLeft: '1px solid', display: 'flex', flexDirection: 'column', flexShrink: 0 },
  chatHeader: { padding: '10px 14px', fontSize: 13, fontWeight: 600, color: '#888', borderBottom: '1px solid #1a1a2a', flexShrink: 0 },
  chatMessages: { flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 10 },
  chatEmpty: { color: '#444', fontSize: 13, textAlign: 'center', marginTop: 20 },
  chatMessage: {},
  chatAuthor: { fontSize: 12, fontWeight: 700 },
  chatText: { fontSize: 13, color: '#ccc', marginTop: 2, lineHeight: 1.4 },
  chatForm: { display: 'flex', padding: 10, gap: 8, borderTop: '1px solid #1a1a2a', flexShrink: 0 },
  chatInput: { flex: 1, background: '#16161f', border: '1px solid #2a2a3a', borderRadius: 8, padding: '7px 10px', color: '#f0f0f5', fontSize: 13, outline: 'none' },
  chatSendBtn: { background: '#7c6ef5', border: 'none', borderRadius: 8, color: '#fff', width: 32, cursor: 'pointer', fontSize: 14 },

  // Misc
  loading: { height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#555', background: '#0a0a12' },
  notFound: { height: '100vh', display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center', justifyContent: 'center', color: '#888', background: '#0a0a12' },
  backBtn: { background: '#7c6ef5', border: 'none', borderRadius: 8, color: '#fff', padding: '10px 20px', cursor: 'pointer', fontSize: 14 },
  voiceIcon: { fontSize: 10, marginLeft: 2 },
  popover: { position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 50, width: 280, background: '#16161f', border: '1px solid #2a2a3a', borderRadius: 12, padding: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' },
  popoverHeader: { fontSize: 13, fontWeight: 700, color: '#f0f0f5', marginBottom: 12 },
  popoverSection: { marginBottom: 14 },
  popoverLabelRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 },
  popoverLabel: { fontSize: 12, color: '#aaa', fontWeight: 600 },
  popoverValue: { fontSize: 12, color: '#7c6ef5', fontWeight: 700 },
  meterTrack: { position: 'relative', height: 8, background: '#0a0a12', borderRadius: 4, marginBottom: 8, overflow: 'visible' },
  meterFill: { height: '100%', background: '#4ade80', borderRadius: 4, transition: 'width 60ms linear' },
  meterThreshold: { position: 'absolute', top: -3, bottom: -3, width: 2, background: '#f0f0f5', borderRadius: 1 },
  slider: { width: '100%', cursor: 'pointer', accentColor: '#7c6ef5' },
  sliderHints: { display: 'flex', justifyContent: 'space-between', fontSize: 10, color: '#555', marginTop: 4 },
  deviceSelect: { width: '100%', background: '#0a0a12', border: '1px solid #2a2a3a', borderRadius: 8, color: '#ccc', padding: '7px 10px', fontSize: 12, cursor: 'pointer', outline: 'none' },
  userPopover: { position: 'absolute', top: 'calc(100% + 8px)', left: 0, zIndex: 50, width: 200, background: '#16161f', border: '1px solid #2a2a3a', borderRadius: 12, padding: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.4)' },
}