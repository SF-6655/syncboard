import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function usePresence(roomCode, identity) {
  const [onlineUsers, setOnlineUsers] = useState([])
  const [channel, setChannel] = useState(null)

useEffect(() => {
  if (!roomCode || !identity) return
  console.log('[presence] creating new channel for', roomCode, identity.id)

  const ch = supabase.channel(`room:${roomCode}`, {
      config: {
        presence: { key: identity.id },
        broadcast: { self: false, ack: true },
      },
    })

    ch
      .on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState()
        const users = Object.values(state).map((entries) => entries[0])
        setOnlineUsers(users)
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await ch.track({
            id: identity.id,
            name: identity.name,
            color: identity.color,
            online_at: new Date().toISOString(),
          })
          setChannel(ch)
        }
      })

return () => {
  console.log('[presence] tearing down channel for', roomCode, identity.id)
  ch.unsubscribe()
  setChannel(null)
}
}, [roomCode, identity?.id])

  return { onlineUsers, channel }
}