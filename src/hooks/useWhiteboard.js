import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useWhiteboard(roomId, channel) {
  const [strokes, setStrokes] = useState([])

  useEffect(() => {
    if (!roomId) return

    async function loadStrokes() {
      const { data } = await supabase
        .from('strokes')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
      setStrokes(data || [])
    }
    loadStrokes()

    const sub = supabase
      .channel(`strokes-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'strokes', filter: `room_id=eq.${roomId}` }, (payload) => {
        setStrokes(prev => [...prev, payload.new])
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'strokes', filter: `room_id=eq.${roomId}` }, (payload) => {
        setStrokes(prev => prev.filter(s => s.id !== payload.old.id))
      })
      .subscribe()

    return () => sub.unsubscribe()
  }, [roomId])

  const saveStroke = useCallback(async (stroke) => {
    if (!roomId) return
    await supabase.from('strokes').insert({ ...stroke, room_id: roomId })
  }, [roomId])

  const clearBoard = useCallback(async () => {
    if (!roomId) return
    await supabase.from('strokes').delete().eq('room_id', roomId)
  }, [roomId])

  return { strokes, saveStroke, clearBoard }
}