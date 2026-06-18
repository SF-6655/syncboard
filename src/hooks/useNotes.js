import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useNotes(roomCode, roomId) {
  const [notes, setNotes] = useState([])

  useEffect(() => {
    if (!roomId) return

    async function init() {
      const { data: existingNotes } = await supabase
        .from('notes')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })

      setNotes(existingNotes || [])
    }
    init()
  }, [roomId])

  useEffect(() => {
    if (!roomId) return

    const channel = supabase
      .channel(`notes-changes-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notes', filter: `room_id=eq.${roomId}` }, (payload) => {
        setNotes((prev) => [...prev, payload.new])
      })
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'notes', filter: `room_id=eq.${roomId}` }, (payload) => {
        setNotes((prev) => prev.map((n) => (n.id === payload.new.id ? payload.new : n)))
      })
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'notes', filter: `room_id=eq.${roomId}` }, (payload) => {
        setNotes((prev) => prev.filter((n) => n.id !== payload.old.id))
      })
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [roomId])

  const addNote = useCallback(async (authorName) => {
    if (!roomId) return
    const colors = ['#7c6ef5', '#60a5fa', '#4ade80', '#f59e0b', '#f472b6']
    const color = colors[Math.floor(Math.random() * colors.length)]

    await supabase.from('notes').insert({
      room_id: roomId,
      text: '',
      color,
      x: 100 + Math.random() * 300,
      y: 100 + Math.random() * 200,
      author_name: authorName,
    })
  }, [roomId])

  const updateNote = useCallback(async (id, updates) => {
    await supabase.from('notes').update({ ...updates, updated_at: new Date().toISOString() }).eq('id', id)
  }, [])

  const deleteNote = useCallback(async (id) => {
    await supabase.from('notes').delete().eq('id', id)
  }, [])

  return { notes, addNote, updateNote, deleteNote }
}