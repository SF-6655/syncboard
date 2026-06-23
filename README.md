# ⚡ SyncBoard

A real-time collaborative workspace — sticky notes, live voice chat, and a shared whiteboard, all in the browser. No sign-up required. Just share a room code.

**[Live Demo](https://your-deployment-url.vercel.app)**

---

## What makes this interesting

Most "real-time" demos use polling or basic WebSocket echo servers. SyncBoard uses three distinct Supabase Realtime primitives, each chosen deliberately:

| Channel type | Used for | Why |
|---|---|---|
| **Presence** | Who's online, join/leave | Built-in heartbeat, auto-cleans on disconnect |
| **Broadcast** | Live cursor drag, whiteboard strokes | Ephemeral, no DB write, lowest latency |
| **Postgres Changes** | Notes, chat messages, strokes | Persisted, new joiners see full history |

Voice chat is WebRTC peer-to-peer — Supabase Broadcast handles the signaling (offer/answer/ICE exchange) but audio travels directly between browsers with no server in the path after connection.

Drag sync runs at 60fps locally via direct DOM mutation (`transform: translate3d`) bypassing React state entirely, while broadcasting to other users at ~20fps via `requestAnimationFrame` throttling. This is the same approach Figma uses for collaborative drag.

---

## Features

- **Sticky notes** — create, drag, edit, delete; all synced live across users
- **Collaborative whiteboard** — pencil, marker, eraser with adjustable sizes; strokes broadcast in real time and persist for late joiners
- **Voice chat** — WebRTC P2P audio with noise suppression, echo cancellation, adaptive mic calibration, per-user volume sliders, input/output device selection, and speaking indicators
- **Live presence** — participant sidebar showing who's online and who's talking
- **Live chat** — persistent message history with auto-scroll
- **Room lifecycle** — host/guest roles, close room (cascading delete), 24-hour expiry, session-based identity with custom names
- **Theme switching** — four canvas themes, persisted per user in localStorage

---

## Tech stack

- **React + Vite** — frontend
- **Supabase** — Postgres database, Realtime (Presence + Broadcast + Postgres Changes), Row Level Security
- **WebRTC** — peer-to-peer voice with STUN-based ICE negotiation
- **Web Audio API** — processing chain (highpass filter → compressor → gate) on the mic stream before it enters WebRTC; separate analyser graph for speaking detection with ambient noise floor calibration

---

## Project structure

```
src/
├── components/
│   ├── StickyNote.jsx       # Draggable note with RAF-throttled broadcast
│   ├── Whiteboard.jsx       # Canvas drawing with live stroke sync
│   └── JoinModal.jsx        # Name entry before joining a room
├── hooks/
│   ├── usePresence.js       # Supabase Presence channel
│   ├── useNotes.js          # Notes CRUD + Postgres Changes subscription
│   ├── useChat.js           # Messages + Postgres Changes subscription
│   ├── useWhiteboard.js     # Strokes persistence + Postgres Changes
│   └── useVoiceChat.js      # WebRTC signaling, Web Audio processing chain
├── pages/
│   ├── Landing.jsx          # Create / join room
│   └── Room.jsx             # Main collaborative workspace
└── lib/
    ├── supabase.js
    ├── roomUtils.js         # Identity, room code generation
    └── canvasThemes.js      # Theme tokens
```

---

## Running locally

```bash
git clone https://github.com/SF-6655/syncboard.git
cd syncboard
npm install
```

Create `.env`:

```
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

```bash
npm run dev
```

You'll need a Supabase project with the following tables: `rooms`, `notes`, `messages`, `strokes` — all with Realtime enabled and `REPLICA IDENTITY FULL` set. See the SQL setup in the [wiki](../../wiki) or open an issue and I'll document it further.

---

## Voice chat architecture

```
User A (browser)                    User B (browser)
      │                                    │
      │  voice-join broadcast              │
      │ ─────────────────────────────────► │
      │                                    │
      │         voice-offer (SDP)          │
      │ ◄───────────────────────────────── │
      │                                    │
      │         voice-answer (SDP)         │
      │ ─────────────────────────────────► │
      │                                    │
      │      ICE candidates (both ways)    │
      │ ◄──────────────────────────────►  │
      │                                    │
      └──────── Direct P2P audio ──────────┘
               (no server after this)
```

Signaling uses the same Supabase Broadcast channel as note-drag and whiteboard strokes — no separate WebSocket server needed.

---

## Known limitations / future work

- Rooms are cleaned up client-side (24h check on join) — a Supabase Edge Function cron job would handle this properly server-side
- Voice works well for 2–4 users; larger groups would need an SFU (Selective Forwarding Unit) like LiveKit rather than a full mesh
- No mobile support — canvas interactions are pointer-event based
- Output device selection (`setSinkId`) is limited by browser support

---

## What I learned building this

The hardest part wasn't any single feature — it was understanding which Realtime primitive to use for each problem, and why mixing them up produces subtle bugs. Broadcast events are fire-and-forget with no persistence; Postgres Changes are reliable but slower; Presence handles its own lifecycle automatically. Getting the WebRTC signaling to work reliably required understanding that `listenersAttached` refs tied to channel instances can silently stop receiving events when a channel is recreated, and that `AudioContext` must be created in a user-gesture callback or it stays suspended permanently in Chrome.

---

Built with React, Supabase, and WebRTC.