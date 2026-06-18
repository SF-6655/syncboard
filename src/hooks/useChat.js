import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'

export function useChat(roomCode, roomId) {
  const [messages, setMessages] = useState([])

  useEffect(() => {
    if (!roomId) return

    async function loadMessages() {
      const { data } = await supabase
        .from('messages')
        .select('*')
        .eq('room_id', roomId)
        .order('created_at', { ascending: true })
        .limit(100)

      setMessages(data || [])
    }
    loadMessages()

    const channel = supabase
      .channel(`messages-${roomId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` }, (payload) => {
        setMessages((prev) => [...prev, payload.new])
      })
      .subscribe()

    return () => {
      channel.unsubscribe()
    }
  }, [roomId])

  const sendMessage = useCallback(async (text, authorName, authorColor) => {
    if (!roomId || !text.trim()) return
    await supabase.from('messages').insert({
      room_id: roomId,
      author_name: authorName,
      author_color: authorColor,
      text: text.trim(),
    })
  }, [roomId])

  return { messages, sendMessage }
}