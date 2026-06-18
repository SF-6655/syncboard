# 🚀 SyncBoard

A real-time collaborative workspace built for teams, study groups, and friends.

Create shared rooms, collaborate with sticky notes, see who's online, and communicate through integrated voice chat — all directly in the browser.

---

## ✨ Features

### 📝 Collaborative Sticky Notes

* Create and edit notes in real time
* Drag notes anywhere on the board
* Instant synchronization across connected users
* Live updates powered by Supabase Realtime

### 👥 Presence System

* See who's currently online
* Real-time participant tracking
* User identities with personalized colors

### 🎤 Built-in Voice Chat

* Browser-based voice communication
* WebRTC peer-to-peer audio streaming
* Speaking indicators
* Mute / unmute controls
* Noise suppression and echo cancellation support

### ⚡ Real-Time Collaboration

* Instant updates without refreshing
* Room-based collaboration system
* Live synchronization between participants

### 🎨 Interactive Workspace

* Drag-and-drop interface
* Responsive design
* Smooth animations and interactions
* Lightweight collaborative whiteboard experience

---

## 🛠 Tech Stack

### Frontend

* React
* Vite
* JavaScript

### Backend

* Supabase

  * Authentication
  * Realtime Channels
  * Presence
  * PostgreSQL Database

### Communication

* WebRTC
* STUN Servers
* Peer-to-Peer Audio Streaming

---

## 📂 Project Structure

```text
src/
├── components/
│   ├── StickyNote.jsx
│   ├── VoicePanel.jsx
│   ├── UserPresence.jsx
│   └── RoomHeader.jsx
│
├── hooks/
│   ├── usePresence.js
│   ├── useVoiceChat.js
│   └── useNotes.js
│
├── pages/
│   └── Room.jsx
│
├── lib/
│   └── supabase.js
│
└── App.jsx
```

---

## 🚀 Running Locally

Clone the repository:

```bash
git clone https://github.com/YOUR_USERNAME/syncboard.git
cd syncboard
```

Install dependencies:

```bash
npm install
```

Create a `.env` file:

```env
VITE_SUPABASE_URL=your_supabase_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

Start development server:

```bash
npm run dev
```

---

## 🔊 Voice Chat Architecture

SyncBoard uses WebRTC for direct peer-to-peer voice communication.

Flow:

```text
User A
   │
   ▼
Supabase Realtime Signaling
   │
   ▼
WebRTC Offer / Answer
   │
   ▼
Peer-to-Peer Audio Connection
```

This means audio does not pass through the application server after connection establishment.

---

## 📚 What I Learned

* Building real-time collaborative applications
* Supabase Presence and Broadcast channels
* WebRTC signaling and peer connections
* Audio stream management in the browser
* React performance optimization
* Real-time state synchronization
* Collaborative UX patterns
* Drag-and-drop interaction systems

---

## 🔮 Future Improvements

* Shared drawing canvas
* Multiple boards per room
* File uploads
* Screen sharing
* Room permissions
* Voice activity visualization
* Mobile optimization
* AI meeting summaries
* Persistent collaborative workspaces

---

## 🤝 Contributing

Pull requests and feature suggestions are welcome.

---

Built with ❤️ using React, Supabase, and WebRTC.
