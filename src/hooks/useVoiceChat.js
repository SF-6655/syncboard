import { useState, useRef, useCallback, useEffect } from 'react'

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

// Set to true once you've added the RNNoise wasm assets (see bottom of file
// for setup notes). With this off, you still get highpass + compressor +
// gain-gate, which is most of the improvement for none of the dependency cost.
const ENABLE_RNNOISE = false

// Sensitivity is a user-facing -100..100 slider (Discord-style), where 0
// means "trust the auto-calibrated threshold" and negative/positive values
// shift it down/up. Stored separately from the raw threshold math so the UI
// can show a stable, intuitive number instead of a raw volume unit nobody
// can interpret.
const DEFAULT_SENSITIVITY = 0

// Per-user output gain, as a percentage like Discord's slider. 100 = the
// stream's natural volume, up to 200 = 2x boost for quiet talkers, down to
// 0 = fully silenced without leaving the call.
const DEFAULT_OUTPUT_GAIN = 100

export function useVoiceChat(channel, identity) {
  const [inVoice, setInVoice] = useState(false)
  const [muted, setMuted] = useState(false)
  const [voiceUsers, setVoiceUsers] = useState([])

  // Mic input sensitivity, manually adjustable. -100..100, 0 = auto.
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENSITIVITY)
  const sensitivityRef = useRef(DEFAULT_SENSITIVITY)
  useEffect(() => {
    sensitivityRef.current = sensitivity
  }, [sensitivity])

  // Live local mic level, 0..1, for rendering a meter next to the
  // sensitivity slider so adjusting it isn't just guessing at a number.
  const [micLevel, setMicLevel] = useState(0)

  // Master output volume (affects all remote audio), 0..200, Discord-style.
  const [outputVolume, setOutputVolume] = useState(100)
  const outputVolumeRef = useRef(100)
  useEffect(() => {
    outputVolumeRef.current = outputVolume
    applyAllOutputGains()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outputVolume])

  // Per-remote-user output gain overrides, e.g. { [userId]: 130 }.
  // Missing entries default to DEFAULT_OUTPUT_GAIN.
  const [userOutputGains, setUserOutputGains] = useState({})

  // raw mic stream (unprocessed) — kept around so we can stop its tracks on cleanup
  const rawStreamRef = useRef(null)
  // processed stream — this is what actually gets sent over WebRTC
  const processedStreamRef = useRef(null)

  const peersRef = useRef({})
  const inVoiceRef = useRef(false)

  // Web Audio graph nodes, so we can tear them down cleanly
  const audioCtxRef = useRef(null)
  const gateGainRef = useRef(null)
  const rnnoiseNodeRef = useRef(null)

  // Per-peer playback graph: GainNode driving a MediaStreamDestination that
  // feeds the <audio> element. A plain audioEl.volume can only attenuate
  // (0..1) — it can't boost a quiet talker above their natural level. Routing
  // through a GainNode lets us go up to 2x as well as down to 0.
  const playbackCtxRef = useRef(null)
  const playbackNodesRef = useRef({}) // peerId -> { gainNode, sourceNode }

  const speakingRafRef = useRef(null)

  useEffect(() => {
    inVoiceRef.current = inVoice
  }, [inVoice])

  function getPlaybackContext() {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    return playbackCtxRef.current
  }

  // Recomputes a single peer's effective gain: their per-user override
  // (default 100%) combined with the master output volume, each as a 0..2
  // multiplier off the 0..200 UI scale.
  function applyOutputGain(peerId) {
    const node = playbackNodesRef.current[peerId]
    if (!node) return
    const perUser = userOutputGains[peerId] ?? DEFAULT_OUTPUT_GAIN
    const effective = (perUser / 100) * (outputVolumeRef.current / 100)
    node.gainNode.gain.value = effective
  }

  function applyAllOutputGains() {
    Object.keys(playbackNodesRef.current).forEach(applyOutputGain)
  }

  // Public setter for one user's output gain (0..200). Mirrors Discord's
  // per-user volume slider in the participant list.
  const setUserOutputGain = useCallback((userId, gainPercent) => {
    const clamped = Math.max(0, Math.min(200, gainPercent))
    setUserOutputGains((prev) => ({ ...prev, [userId]: clamped }))
  }, [])

  useEffect(() => {
    applyAllOutputGains()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userOutputGains])

  // Bumps Opus bitrate on the audio sender. Safe to call multiple times —
  // it's a no-op if there's no audio sender yet. Needs to run both right
  // after the initial offer/answer AND on renegotiation, since a fresh
  // RTCPeerConnection has no senders until a track is added and SDP exchanged.
  const tuneAudioBitrate = useCallback(async (pc) => {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
    if (!sender) return
    try {
      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}]
      }
      params.encodings[0].maxBitrate = 64000
      await sender.setParameters(params)
    } catch {
      // setParameters can throw if called before the first negotiation
      // has fully settled on some browsers — safe to ignore, we retry
      // on the next negotiationneeded event anyway.
    }
  }, [])

  const createPeerConnection = useCallback((peerId) => {
    if (peersRef.current[peerId]) {
      return peersRef.current[peerId]
    }

    const pc = new RTCPeerConnection(ICE_SERVERS)

    if (processedStreamRef.current) {
      processedStreamRef.current.getTracks().forEach((track) => {
        pc.addTrack(track, processedStreamRef.current)
      })
    }

    pc.onicecandidate = (event) => {
      if (event.candidate && channel) {
        channel.send({
          type: 'broadcast',
          event: 'voice-ice',
          payload: { from: identity.id, to: peerId, candidate: event.candidate },
        })
      }
    }

    pc.onnegotiationneeded = () => {
      tuneAudioBitrate(pc)
    }

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0]

      // Build a small per-peer playback graph: remote stream -> GainNode ->
      // MediaStreamDestination -> <audio>. We can't just set audioEl.volume
      // because that's clamped to 0..1 (attenuate-only); a GainNode lets the
      // per-user slider go above 100% to boost quiet talkers, matching the
      // Discord-style control we're exposing.
      const playbackCtx = getPlaybackContext()

      // Tear down any existing graph for this peer first (e.g. reconnect).
      const existing = playbackNodesRef.current[peerId]
      if (existing) {
        try {
          existing.sourceNode.disconnect()
          existing.gainNode.disconnect()
        } catch {}
      }

      const sourceNode = playbackCtx.createMediaStreamSource(remoteStream)
      const gainNode = playbackCtx.createGain()
      const destinationNode = playbackCtx.createMediaStreamDestination()

      sourceNode.connect(gainNode)
      gainNode.connect(destinationNode)

      playbackNodesRef.current[peerId] = { gainNode, sourceNode }
      applyOutputGain(peerId)

      let audioEl = document.getElementById(`voice-audio-${peerId}`)
      if (!audioEl) {
        audioEl = document.createElement('audio')
        audioEl.id = `voice-audio-${peerId}`
        audioEl.autoplay = true
        document.body.appendChild(audioEl)
      }
      audioEl.srcObject = destinationNode.stream
      audioEl.play().catch(() => {})
    }

    peersRef.current[peerId] = pc
    return pc
  }, [channel, identity, tuneAudioBitrate])

  // Builds the Web Audio processing chain: source -> highpass -> compressor
  // -> [optional RNNoise] -> gateGain -> destination.
  //
  // gateGain is a GainNode, not track.enabled. That matters: ramping gain
  // over ~30ms avoids clipping the leading edge of speech (which is what
  // happens if you flip track.enabled = true the instant speech is detected)
  // and avoids audible clicks/pops, which boolean track switching causes.
  async function buildProcessingChain(rawStream) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000,
    })
    audioCtxRef.current = audioCtx

    const source = audioCtx.createMediaStreamSource(rawStream)

    const highpass = audioCtx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 100 // cuts AC hum, desk rumble, fan noise

    const compressor = audioCtx.createDynamicsCompressor()
    compressor.threshold.value = -24
    compressor.knee.value = 30
    compressor.ratio.value = 12
    compressor.attack.value = 0.003
    compressor.release.value = 0.25

    const gateGain = audioCtx.createGain()
    // Start at full gain — gate state catches up once speaking detection
    // calibrates. Starting muted would clip the user's first word.
    gateGain.gain.value = 1
    gateGainRef.current = gateGain

    const destination = audioCtx.createMediaStreamDestination()

    let chainTail = highpass
    source.connect(highpass)

    if (ENABLE_RNNOISE) {
      try {
        const rnnoiseNode = await createRNNoiseNode(audioCtx)
        if (rnnoiseNode) {
          chainTail.connect(rnnoiseNode)
          chainTail = rnnoiseNode
          rnnoiseNodeRef.current = rnnoiseNode
        }
      } catch (err) {
        console.warn('RNNoise failed to load, continuing without it:', err)
      }
    }

    chainTail.connect(compressor)
    compressor.connect(gateGain)
    gateGain.connect(destination)

    return destination.stream
  }

  // Smoothly ramps the gate gain instead of snapping it, so speech onset
  // isn't clipped and there's no audible click at the transition.
  function setGateOpen(open) {
    const gateGain = gateGainRef.current
    const audioCtx = audioCtxRef.current
    if (!gateGain || !audioCtx) return
    const target = open ? 1 : 0.06 // not fully zero — fully silencing can sound like a dropped connection
    gateGain.gain.cancelScheduledValues(audioCtx.currentTime)
    gateGain.gain.linearRampToValueAtTime(target, audioCtx.currentTime + 0.03)
  }

  // Calibrates to ambient noise for ~600ms to get a starting threshold, then
  // continuously re-derives the *effective* threshold from sensitivityRef on
  // every frame. This means dragging the sensitivity slider mid-call takes
  // effect immediately — it doesn't require leaving and rejoining voice.
  //
  // sensitivity is -100..100. 0 keeps the auto-calibrated threshold as-is.
  // Negative values lower the threshold (mic opens more easily — good for a
  // quiet talker or quiet room). Positive values raise it (mic stays closed
  // until you're louder — good for a noisy room). The mapping is exponential
  // rather than linear because perceived "sensitivity" doesn't scale evenly:
  // a fixed multiplier feels too coarse near the auto value and too weak at
  // the extremes if done linearly.
  function startSpeakingDetection(stream, onSpeaking, onLevel) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)()
    const analyser = audioCtx.createAnalyser()
    const source = audioCtx.createMediaStreamSource(stream)
    source.connect(analyser)
    analyser.fftSize = 1024
    analyser.smoothingTimeConstant = 0.85
    const data = new Uint8Array(analyser.frequencyBinCount)

    let calibrating = true
    let calibrationSamples = []
    let autoThreshold = 28
    let speakingFrames = 0
    let silentFrames = 0
    let currentlySpeaking = false
    const FRAMES_TO_CONFIRM = 5
    const calibrationStart = Date.now()

    // Roughly normalizes the 0..255 analyser scale to a 0..1 meter range for
    // typical speech volumes, so the UI meter fills sensibly instead of
    // looking either always-empty or always-pinned.
    const METER_SCALE = 80

    function effectiveThreshold() {
      // slider -100..100 -> multiplier ~0.35x (most sensitive) .. ~2.8x (least)
      const s = sensitivityRef.current
      const multiplier = Math.pow(2, -s / 65)
      return autoThreshold * multiplier
    }

    function check() {
      analyser.getByteFrequencyData(data)
      // Focus on the voice-relevant frequency range, ignoring low rumble and high hiss
      const voiceRange = data.slice(4, 80)
      const volume = voiceRange.reduce((a, b) => a + b, 0) / voiceRange.length

      if (onLevel) {
        onLevel(Math.max(0, Math.min(1, volume / METER_SCALE)))
      }

      if (calibrating) {
        calibrationSamples.push(volume)
        if (Date.now() - calibrationStart > 600) {
          calibrating = false
          const avg = calibrationSamples.reduce((a, b) => a + b, 0) / calibrationSamples.length
          autoThreshold = Math.max(avg * 2.2, 18)
        }
      } else {
        const threshold = effectiveThreshold()
        if (volume > threshold) {
          speakingFrames++
          silentFrames = 0
        } else {
          silentFrames++
          speakingFrames = 0
        }

        if (!currentlySpeaking && speakingFrames >= FRAMES_TO_CONFIRM) {
          currentlySpeaking = true
          onSpeaking(true)
        } else if (currentlySpeaking && silentFrames >= FRAMES_TO_CONFIRM) {
          currentlySpeaking = false
          onSpeaking(false)
        }
      }

      speakingRafRef.current = requestAnimationFrame(check)
    }
    check()

    // Return the analyser's own AudioContext so callers can close it independently
    // of the processing-chain context (they're separate graphs).
    return audioCtx
  }

  const detectionCtxRef = useRef(null)

  const joinVoice = useCallback(async () => {
    try {
      const rawStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: 48000,
          channelCount: 1,
        },
      })
      rawStreamRef.current = rawStream

      const processedStream = await buildProcessingChain(rawStream)
      processedStreamRef.current = processedStream

      setInVoice(true)

      setVoiceUsers((prev) =>
        prev.find((u) => u.id === identity.id) ? prev : [...prev, { id: identity.id, name: identity.name, speaking: false }]
      )

      // Run speech detection on the RAW stream (pre-gate), not the processed
      // one — gating the processed stream while analyzing the gated signal
      // creates a feedback loop where the gate can never reopen once closed.
      detectionCtxRef.current = startSpeakingDetection(
        rawStream,
        (speaking) => {
          setGateOpen(speaking)
          setVoiceUsers((prev) => prev.map((u) => (u.id === identity.id ? { ...u, speaking } : u)))
          if (channel) {
            channel.send({ type: 'broadcast', event: 'voice-speaking', payload: { id: identity.id, speaking } })
          }
        },
        (level) => setMicLevel(level)
      )

      if (channel) {
        await channel.send({
          type: 'broadcast',
          event: 'voice-join',
          payload: { id: identity.id, name: identity.name },
        })
      }
    } catch (err) {
      alert('Microphone access denied or unavailable.')
    }
  }, [channel, identity])

  const leaveVoice = useCallback(() => {
    if (speakingRafRef.current) cancelAnimationFrame(speakingRafRef.current)

    if (detectionCtxRef.current) {
      detectionCtxRef.current.close().catch(() => {})
      detectionCtxRef.current = null
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    rnnoiseNodeRef.current = null
    gateGainRef.current = null
    setMicLevel(0)

    Object.values(playbackNodesRef.current).forEach(({ sourceNode, gainNode }) => {
      try {
        sourceNode.disconnect()
        gainNode.disconnect()
      } catch {}
    })
    playbackNodesRef.current = {}
    if (playbackCtxRef.current) {
      playbackCtxRef.current.close().catch(() => {})
      playbackCtxRef.current = null
    }

    if (rawStreamRef.current) {
      rawStreamRef.current.getTracks().forEach((t) => t.stop())
      rawStreamRef.current = null
    }
    if (processedStreamRef.current) {
      processedStreamRef.current.getTracks().forEach((t) => t.stop())
      processedStreamRef.current = null
    }

    Object.values(peersRef.current).forEach((pc) => pc.close())
    peersRef.current = {}
    setInVoice(false)
    setVoiceUsers([])

    if (channel) {
      channel.send({
        type: 'broadcast',
        event: 'voice-leave',
        payload: { id: identity.id },
      })
    }

    document.querySelectorAll('[id^="voice-audio-"]').forEach((el) => el.remove())
  }, [channel, identity])

  const toggleMute = useCallback(() => {
    if (!rawStreamRef.current) return
    const newMuted = !muted
    rawStreamRef.current.getAudioTracks().forEach((track) => {
      track.enabled = !newMuted
    })
    setMuted(newMuted)
  }, [muted])

  useEffect(() => {
    if (!channel) return

    async function handleVoiceJoin(payload) {
      const { id, name } = payload.payload
      if (id === identity.id) return

      setVoiceUsers((prev) => (prev.find((u) => u.id === id) ? prev : [...prev, { id, name, speaking: false }]))

      if (inVoiceRef.current && !peersRef.current[id]) {
        const pc = createPeerConnection(id)
        const offer = await pc.createOffer()
        await pc.setLocalDescription(offer)
        channel.send({
          type: 'broadcast',
          event: 'voice-offer',
          payload: { from: identity.id, to: id, offer },
        })
      }
    }

    async function handleVoiceOffer(payload) {
      const { from, to, offer } = payload.payload
      if (to !== identity.id) return
      const pc = createPeerConnection(from)
      if (pc.signalingState !== 'stable') return
      await pc.setRemoteDescription(offer)
      const answer = await pc.createAnswer()
      await pc.setLocalDescription(answer)
      channel.send({
        type: 'broadcast',
        event: 'voice-answer',
        payload: { from: identity.id, to: from, answer },
      })
      tuneAudioBitrate(pc)
    }

    async function handleVoiceAnswer(payload) {
      const { from, to, answer } = payload.payload
      if (to !== identity.id) return
      const pc = peersRef.current[from]
      if (pc && pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(answer)
        tuneAudioBitrate(pc)
      }
    }

    async function handleVoiceIce(payload) {
      const { from, to, candidate } = payload.payload
      if (to !== identity.id) return
      const pc = peersRef.current[from]
      if (pc) {
        try {
          await pc.addIceCandidate(candidate)
        } catch {}
      }
    }

    function handleVoiceLeave(payload) {
      const { id } = payload.payload
      setVoiceUsers((prev) => prev.filter((u) => u.id !== id))
      const pc = peersRef.current[id]
      if (pc) {
        pc.close()
        delete peersRef.current[id]
      }
      const playbackNode = playbackNodesRef.current[id]
      if (playbackNode) {
        try {
          playbackNode.sourceNode.disconnect()
          playbackNode.gainNode.disconnect()
        } catch {}
        delete playbackNodesRef.current[id]
      }
      const audioEl = document.getElementById(`voice-audio-${id}`)
      if (audioEl) audioEl.remove()
    }

    function handleVoiceSpeaking(payload) {
      const { id, speaking } = payload.payload
      setVoiceUsers((prev) => prev.map((u) => (u.id === id ? { ...u, speaking } : u)))
    }

    channel.on('broadcast', { event: 'voice-join' }, handleVoiceJoin)
    channel.on('broadcast', { event: 'voice-offer' }, handleVoiceOffer)
    channel.on('broadcast', { event: 'voice-answer' }, handleVoiceAnswer)
    channel.on('broadcast', { event: 'voice-ice' }, handleVoiceIce)
    channel.on('broadcast', { event: 'voice-leave' }, handleVoiceLeave)
    channel.on('broadcast', { event: 'voice-speaking' }, handleVoiceSpeaking)
  }, [channel, identity, createPeerConnection, tuneAudioBitrate])

  return {
    inVoice,
    muted,
    voiceUsers,
    joinVoice,
    leaveVoice,
    toggleMute,

    // Input sensitivity control: -100..100, 0 = auto-calibrated. Live mic
    // level (0..1) is provided alongside it so the UI can render a meter —
    // a bare slider with no feedback is hard to tune correctly.
    sensitivity,
    setSensitivity,
    micLevel,

    // Output controls, Discord-style: a master volume and per-user overrides.
    // Both are 0..200 (percent), where 100 is unity gain and >100 boosts.
    outputVolume,
    setOutputVolume,
    userOutputGains,
    setUserOutputGain,
  }
}

// --- RNNoise setup (only used if ENABLE_RNNOISE = true above) ---
//
// 1. npm install @sapphi-red/web-noise-suppressor
// 2. Copy its worklet files + wasm binary into your /public directory
//    (the package ships them under dist/; check its README for the exact
//    files — it changes between versions, so don't hardcode paths blindly).
// 3. Implement createRNNoiseNode below using that package's
//    addNoiseSuppressorWorklet / RnnoiseWorkletNode API.
//
// This is left as a stub rather than guessed-at code because the package's
// worklet registration path and constructor signature are version-specific;
// wiring it against the wrong version silently fails (the AudioWorklet just
// never loads) rather than throwing, which makes it nasty to debug from
// fabricated example code. Check the installed version's README directly.
async function createRNNoiseNode(audioCtx) {
  throw new Error('createRNNoiseNode not implemented — see setup notes above')
}