import { useState, useRef, useEffect, memo } from 'react'

function StickyNote({ note, onUpdate, onDelete, onDragBroadcast }) {
  const [text, setText] = useState(note.text)
  const [dragging, setDragging] = useState(false)
  const dragOffset = useRef({ x: 0, y: 0 })
  const noteRef = useRef(null)
  const saveTimeout = useRef(null)
  const rafPending = useRef(false)
  const latestEvent = useRef(null)
  const justDropped = useRef(false)
  const lastBroadcast = useRef(0)

  useEffect(() => {
    setText(note.text)
  }, [note.text])

  // Apply remote drag updates (from other users) via transform, GPU-accelerated
  useEffect(() => {
    if (dragging) return
    if (justDropped.current) {
      justDropped.current = false
      return
    }
    if (note.liveX !== undefined && noteRef.current) {
      const dx = note.liveX - note.x
      const dy = note.liveY - note.y
      noteRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
    } else if (noteRef.current) {
      noteRef.current.style.transform = 'translate3d(0,0,0)'
    }
  }, [note.liveX, note.liveY, note.x, note.y, dragging])

  function handleMouseDown(e) {
    if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'BUTTON') return
    setDragging(true)
    const rect = noteRef.current.getBoundingClientRect()
    dragOffset.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }

    function handleMouseMove(moveEvent) {
      latestEvent.current = moveEvent
      if (rafPending.current) return
      rafPending.current = true

      requestAnimationFrame(() => {
        rafPending.current = false
        const ev = latestEvent.current
        const canvas = noteRef.current.parentElement.getBoundingClientRect()
        const newX = ev.clientX - canvas.left - dragOffset.current.x
        const newY = ev.clientY - canvas.top - dragOffset.current.y

        // Move locally via direct DOM transform — bypasses React entirely, feels glued to cursor
        const dx = newX - note.x
        const dy = newY - note.y
        if (noteRef.current) {
          noteRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
        }

        // Throttle network broadcasts to ~20/sec, independent of local 60fps drag smoothness
        const now = Date.now()
        if (now - lastBroadcast.current > 50) {
          onDragBroadcast(note.id, newX, newY)
          lastBroadcast.current = now
        }
      })
    }

    function handleMouseUp(upEvent) {
      const canvas = noteRef.current.parentElement.getBoundingClientRect()
      const finalX = upEvent.clientX - canvas.left - dragOffset.current.x
      const finalY = upEvent.clientY - canvas.top - dragOffset.current.y

      // Keep the transform pinned at the final drop position locally
      // so there's no visual snap-back while waiting for the DB round-trip
      const dx = finalX - note.x
      const dy = finalY - note.y
      if (noteRef.current) {
        noteRef.current.style.transform = `translate3d(${dx}px, ${dy}px, 0)`
      }

      justDropped.current = true
      onUpdate(note.id, { x: finalX, y: finalY })
      setDragging(false)
      window.removeEventListener('mousemove', handleMouseMove)
      window.removeEventListener('mouseup', handleMouseUp)
    }

    window.addEventListener('mousemove', handleMouseMove)
    window.addEventListener('mouseup', handleMouseUp)
  }

  function handleTextChange(e) {
    const newText = e.target.value
    setText(newText)
    clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => {
      onUpdate(note.id, { text: newText })
    }, 500)
  }

  function handleTextBlur() {
    clearTimeout(saveTimeout.current)
    if (text !== note.text) {
      onUpdate(note.id, { text })
    }
  }

  return (
    <div
      ref={noteRef}
      onMouseDown={handleMouseDown}
      style={{
        ...s.note,
        left: note.x,
        top: note.y,
        background: note.color,
        cursor: dragging ? 'grabbing' : 'grab',
        zIndex: dragging ? 100 : 1,
        boxShadow: dragging ? '0 12px 24px rgba(0,0,0,0.4)' : '0 4px 12px rgba(0,0,0,0.25)',
      }}
    >
      <div style={s.noteHeader}>
        <span style={s.author}>{note.author_name}</span>
        <button onClick={() => onDelete(note.id)} style={s.deleteBtn}>✕</button>
      </div>
      <textarea
        value={text}
        onChange={handleTextChange}
        onBlur={handleTextBlur}
        onMouseDown={(e) => e.stopPropagation()}
        placeholder="Type something..."
        style={s.textarea}
      />
    </div>
  )
}

export default memo(StickyNote)

const s = {
  note: {
    position: 'absolute', width: 180, minHeight: 160,
    borderRadius: 8, padding: 12, userSelect: 'none',
    display: 'flex', flexDirection: 'column', gap: 8,
    willChange: 'transform',
  },
  noteHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  author: { fontSize: 11, fontWeight: 700, color: 'rgba(0,0,0,0.55)' },
  deleteBtn: {
    background: 'rgba(0,0,0,0.15)', border: 'none', borderRadius: 4,
    width: 20, height: 20, cursor: 'pointer', fontSize: 11, color: 'rgba(0,0,0,0.6)',
  },
  textarea: {
    flex: 1, background: 'rgba(255,255,255,0.25)', border: 'none',
    borderRadius: 6, padding: 8, fontSize: 13, color: 'rgba(0,0,0,0.85)',
    resize: 'none', outline: 'none', fontFamily: 'inherit',
  },
}