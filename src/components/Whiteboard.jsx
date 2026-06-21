import { useRef, useState, useEffect, useCallback } from 'react'

const TOOLS = {
  pencil: { label: '✏️', defaultSize: 2, opacity: 1 },
  marker: { label: '🖊️', defaultSize: 8, opacity: 0.6 },
  eraser: { label: '⬜', defaultSize: 20, opacity: 1 },
}

const COLORS = ['#ffffff', '#f87171', '#fb923c', '#fbbf24', '#4ade80', '#60a5fa', '#a78bfa', '#f472b6', '#000000']

export default function Whiteboard({ strokes, onStrokeComplete, onClear, channel, identity }) {
  const canvasRef = useRef(null)
  const overlayRef = useRef(null)
  const [tool, setTool] = useState('pencil')
  const [color, setColor] = useState('#ffffff')
  const [size, setSize] = useState(2)
  const [isDrawing, setIsDrawing] = useState(false)
  const currentStrokeRef = useRef([])
  const lastBroadcastRef = useRef(0)
  const [liveStrokes, setLiveStrokes] = useState({})

  // Redraw all persisted strokes whenever they change
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    strokes.forEach(stroke => drawStroke(ctx, stroke))
  }, [strokes])

  // Listen for live broadcast strokes from others
  useEffect(() => {
    if (!channel) return
    channel.on('broadcast', { event: 'wb-draw' }, (payload) => {
      const { userId, points, color, size, tool } = payload.payload
      if (userId === identity?.id) return
      setLiveStrokes(prev => ({ ...prev, [userId]: { points, color, size, tool } }))
    })
    channel.on('broadcast', { event: 'wb-end' }, (payload) => {
      const { userId } = payload.payload
      setLiveStrokes(prev => {
        const next = { ...prev }
        delete next[userId]
        return next
      })
    })
  }, [channel, identity])

  // Redraw live strokes overlay
  useEffect(() => {
    const overlay = overlayRef.current
    if (!overlay) return
    const ctx = overlay.getContext('2d')
    ctx.clearRect(0, 0, overlay.width, overlay.height)
    Object.values(liveStrokes).forEach(stroke => drawStroke(ctx, stroke))
  }, [liveStrokes])

  function drawStroke(ctx, stroke) {
    if (!stroke.points || stroke.points.length < 2) return
    ctx.save()
    ctx.globalCompositeOperation = stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
    ctx.strokeStyle = stroke.color
    ctx.lineWidth = stroke.size
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.globalAlpha = TOOLS[stroke.tool]?.opacity ?? 1
    ctx.beginPath()
    ctx.moveTo(stroke.points[0].x, stroke.points[0].y)
    for (let i = 1; i < stroke.points.length; i++) {
      ctx.lineTo(stroke.points[i].x, stroke.points[i].y)
    }
    ctx.stroke()
    ctx.restore()
  }

  function getPos(e, canvas) {
    const rect = canvas.getBoundingClientRect()
    const clientX = e.touches ? e.touches[0].clientX : e.clientX
    const clientY = e.touches ? e.touches[0].clientY : e.clientY
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top) * (canvas.height / rect.height),
    }
  }

  function handleMouseDown(e) {
    e.preventDefault()
    const canvas = canvasRef.current
    const pos = getPos(e, canvas)
    currentStrokeRef.current = [pos]
    setIsDrawing(true)
  }

  function handleMouseMove(e) {
    e.preventDefault()
    if (!isDrawing) return
    const canvas = canvasRef.current
    const pos = getPos(e, canvas)
    currentStrokeRef.current.push(pos)

    // Draw locally in real time
    const ctx = canvas.getContext('2d')
    const points = currentStrokeRef.current
    if (points.length >= 2) {
      ctx.save()
      ctx.globalCompositeOperation = tool === 'eraser' ? 'destination-out' : 'source-over'
      ctx.strokeStyle = color
      ctx.lineWidth = size
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.globalAlpha = TOOLS[tool]?.opacity ?? 1
      ctx.beginPath()
      ctx.moveTo(points[points.length - 2].x, points[points.length - 2].y)
      ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y)
      ctx.stroke()
      ctx.restore()
    }

    // Broadcast to others at ~20fps
    const now = Date.now()
    if (now - lastBroadcastRef.current > 50 && channel) {
      lastBroadcastRef.current = now
      channel.send({
        type: 'broadcast',
        event: 'wb-draw',
        payload: { userId: identity?.id, points: currentStrokeRef.current, color, size, tool },
      })
    }
  }

  function handleMouseUp(e) {
    e.preventDefault()
    if (!isDrawing) return
    setIsDrawing(false)

    const stroke = {
      points: currentStrokeRef.current,
      color,
      size,
      tool,
      author_id: identity?.id,
      author_color: identity?.color,
    }

    if (stroke.points.length > 1) {
      onStrokeComplete(stroke)
    }

    // Clear live stroke for self
    if (channel) {
      channel.send({ type: 'broadcast', event: 'wb-end', payload: { userId: identity?.id } })
    }
    currentStrokeRef.current = []
  }

  function handleToolChange(newTool) {
    setTool(newTool)
    setSize(TOOLS[newTool].defaultSize)
  }

  return (
    <div style={s.wrapper}>
      {/* Toolbar */}
      <div style={s.toolbar}>
        <div style={s.toolGroup}>
          {Object.entries(TOOLS).map(([key, t]) => (
            <button
              key={key}
              onClick={() => handleToolChange(key)}
              title={key}
              style={{
                ...s.toolBtn,
                background: tool === key ? '#7c6ef5' : '#1a1a2a',
                border: `1px solid ${tool === key ? '#7c6ef5' : '#2a2a3a'}`,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div style={s.toolGroup}>
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => { setColor(c); if (tool === 'eraser') setTool('pencil') }}
              style={{
                ...s.colorBtn,
                background: c,
                border: color === c ? '2px solid #fff' : '2px solid transparent',
                boxShadow: color === c ? `0 0 6px ${c}` : 'none',
              }}
            />
          ))}
        </div>

        <div style={s.toolGroup}>
          <span style={s.sizeLabel}>Size</span>
          <input
            type="range" min={1} max={40} value={size}
            onChange={(e) => setSize(Number(e.target.value))}
            style={{ ...s.sizeSlider, accentColor: '#7c6ef5', width: 80 }}
          />
          <span style={s.sizeValue}>{size}px</span>
        </div>

        <div style={s.toolGroup}>
          <button onClick={onClear} style={s.clearBtn}>🗑️ Clear all</button>
        </div>
      </div>

      {/* Canvas area */}
      <div style={s.canvasArea}>
        <canvas
          ref={canvasRef}
          width={1200}
          height={600}
          style={{ ...s.canvas, cursor: tool === 'eraser' ? 'cell' : 'crosshair' }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
        />
        <canvas
          ref={overlayRef}
          width={1200}
          height={600}
          style={{ ...s.canvas, ...s.overlay, pointerEvents: 'none' }}
        />
      </div>
    </div>
  )
}

const s = {
  wrapper: { display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: '#0d0d16', borderRadius: 12, overflow: 'hidden' },
  toolbar: { display: 'flex', alignItems: 'center', gap: 16, padding: '10px 16px', borderBottom: '1px solid #1a1a2a', flexWrap: 'wrap', flexShrink: 0 },
  toolGroup: { display: 'flex', alignItems: 'center', gap: 6 },
  toolBtn: { width: 34, height: 34, borderRadius: 8, cursor: 'pointer', fontSize: 16, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  colorBtn: { width: 22, height: 22, borderRadius: '50%', cursor: 'pointer', padding: 0 },
  sizeLabel: { fontSize: 11, color: '#666' },
  sizeSlider: { cursor: 'pointer' },
  sizeValue: { fontSize: 11, color: '#888', minWidth: 28 },
  clearBtn: { background: '#1a1a1a', border: '1px solid #3a1a1a', borderRadius: 8, color: '#f87171', padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  canvasArea: { flex: 1, position: 'relative', overflow: 'auto' },
  canvas: { position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' },
  overlay: { zIndex: 1 },
}