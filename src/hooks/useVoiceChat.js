import { useState, useRef, useCallback, useEffect } from 'react'

const ICE_SERVERS = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

const ENABLE_RNNOISE = false
const DEFAULT_SENSITIVITY = 0
const DEFAULT_OUTPUT_GAIN = 100

export function useVoiceChat(channel, identity) {
  const [inVoice, setInVoice] = useState(false)
  const [muted, setMuted] = useState(false)
  const [voiceUsers, setVoiceUsers] = useState([])
  const [sensitivity, setSensitivity] = useState(DEFAULT_SENSITIVITY)
  const sensitivityRef = useRef(DEFAULT_SENSITIVITY)
  const [micLevel, setMicLevel] = useState(0)
  const [outputVolume, setOutputVolume] = useState(100)
  const outputVolumeRef = useRef(100)
  const [userOutputGains, setUserOutputGains] = useState({})
  const [audioDevices, setAudioDevices] = useState({ inputs: [], outputs: [] })
  const [selectedInput, setSelectedInput] = useState('')
  const [selectedOutput, setSelectedOutput] = useState('')
  const selectedOutputRef = useRef('')

  const rawStreamRef = useRef(null)
  const processedStreamRef = useRef(null)
  const peersRef = useRef({})
  const inVoiceRef = useRef(false)
  const audioCtxRef = useRef(null)
  const gateGainRef = useRef(null)
  const rnnoiseNodeRef = useRef(null)
  const playbackCtxRef = useRef(null)
  const playbackNodesRef = useRef({})
  const speakingRafRef = useRef(null)
  const detectionCtxRef = useRef(null)

  useEffect(() => { inVoiceRef.current = inVoice }, [inVoice])
  useEffect(() => { sensitivityRef.current = sensitivity }, [sensitivity])
  useEffect(() => {
    outputVolumeRef.current = outputVolume
    applyAllOutputGains()
  }, [outputVolume])
  useEffect(() => { applyAllOutputGains() }, [userOutputGains])
  useEffect(() => {
    selectedOutputRef.current = selectedOutput
    if (selectedOutput) applyOutputDevice(selectedOutput)
  }, [selectedOutput])

  // Load available audio devices
  useEffect(() => {
    async function loadDevices() {
      try {
        const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        tempStream.getTracks().forEach(t => t.stop())
      } catch {}

      const devices = await navigator.mediaDevices.enumerateDevices()
      const inputs = devices.filter(d => d.kind === 'audioinput')
      const outputs = devices.filter(d => d.kind === 'audiooutput')
      setAudioDevices({ inputs, outputs })
      setSelectedInput(prev => prev || (inputs[0]?.deviceId ?? ''))
      setSelectedOutput(prev => prev || (outputs[0]?.deviceId ?? ''))
    }

    loadDevices()
    navigator.mediaDevices.addEventListener('devicechange', loadDevices)
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices)
  }, [])

  function getPlaybackContext() {
    if (!playbackCtxRef.current) {
      playbackCtxRef.current = new (window.AudioContext || window.webkitAudioContext)()
    }
    return playbackCtxRef.current
  }

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

  function applyOutputDevice(deviceId) {
    document.querySelectorAll('[id^="voice-audio-"]').forEach((el) => {
      if (el.setSinkId) el.setSinkId(deviceId).catch(() => {})
    })
  }

  const setUserOutputGain = useCallback((userId, gainPercent) => {
    const clamped = Math.max(0, Math.min(200, gainPercent))
    setUserOutputGains((prev) => ({ ...prev, [userId]: clamped }))
  }, [])

  const tuneAudioBitrate = useCallback(async (pc) => {
    const sender = pc.getSenders().find((s) => s.track?.kind === 'audio')
    if (!sender) return
    try {
      const params = sender.getParameters()
      if (!params.encodings || params.encodings.length === 0) params.encodings = [{}]
      params.encodings[0].maxBitrate = 64000
      await sender.setParameters(params)
    } catch {}
  }, [])

  const createPeerConnection = useCallback((peerId) => {
    if (peersRef.current[peerId]) return peersRef.current[peerId]

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

    pc.onnegotiationneeded = () => { tuneAudioBitrate(pc) }

    pc.ontrack = (event) => {
      const remoteStream = event.streams[0]
      const playbackCtx = getPlaybackContext()

      const existing = playbackNodesRef.current[peerId]
      if (existing) {
        try { existing.sourceNode.disconnect(); existing.gainNode.disconnect() } catch {}
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
      if (selectedOutputRef.current && audioEl.setSinkId) {
        audioEl.setSinkId(selectedOutputRef.current).catch(() => {})
      }
      audioEl.play().catch(() => {})
    }

    peersRef.current[peerId] = pc
    return pc
  }, [channel, identity, tuneAudioBitrate])

  async function buildProcessingChain(rawStream) {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 48000 })
    audioCtxRef.current = audioCtx

    const source = audioCtx.createMediaStreamSource(rawStream)
    const highpass = audioCtx.createBiquadFilter()
    highpass.type = 'highpass'
    highpass.frequency.value = 100

    const compressor = audioCtx.createDynamicsCompressor()
    compressor.threshold.value = -24
    compressor.knee.value = 30
    compressor.ratio.value = 12
    compressor.attack.value = 0.003
    compressor.release.value = 0.25

    const gateGain = audioCtx.createGain()
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

  function setGateOpen(open) {
    const gateGain = gateGainRef.current
    const audioCtx = audioCtxRef.current
    if (!gateGain || !audioCtx) return
    const target = open ? 1 : 0.06
    gateGain.gain.cancelScheduledValues(audioCtx.currentTime)
    gateGain.gain.linearRampToValueAtTime(target, audioCtx.currentTime + 0.03)
  }

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
    const METER_SCALE = 80

    function effectiveThreshold() {
      const s = sensitivityRef.current
      const multiplier = Math.pow(2, -s / 65)
      return autoThreshold * multiplier
    }

    function check() {
      analyser.getByteFrequencyData(data)
      const voiceRange = data.slice(4, 80)
      const volume = voiceRange.reduce((a, b) => a + b, 0) / voiceRange.length

      if (onLevel) onLevel(Math.max(0, Math.min(1, volume / METER_SCALE)))

      if (calibrating) {
        calibrationSamples.push(volume)
        if (Date.now() - calibrationStart > 600) {
          calibrating = false
          const avg = calibrationSamples.reduce((a, b) => a + b, 0) / calibrationSamples.length
          autoThreshold = Math.max(avg * 2.2, 18)
        }
      } else {
        const threshold = effectiveThreshold()
        if (volume > threshold) { speakingFrames++; silentFrames = 0 }
        else { silentFrames++; speakingFrames = 0 }

        if (!currentlySpeaking && speakingFrames >= FRAMES_TO_CONFIRM) {
          currentlySpeaking = true; onSpeaking(true)
        } else if (currentlySpeaking && silentFrames >= FRAMES_TO_CONFIRM) {
          currentlySpeaking = false; onSpeaking(false)
        }
      }
      speakingRafRef.current = requestAnimationFrame(check)
    }
    check()
    return audioCtx
  }

  const joinVoice = useCallback(async () => {
    try {
      const audioConstraints = {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        sampleRate: 48000,
        channelCount: 1,
      }
      if (selectedInput) audioConstraints.deviceId = { exact: selectedInput }

      const rawStream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
      rawStreamRef.current = rawStream

      const processedStream = await buildProcessingChain(rawStream)
      processedStreamRef.current = processedStream

      setInVoice(true)
      setVoiceUsers((prev) =>
        prev.find((u) => u.id === identity.id) ? prev : [...prev, { id: identity.id, name: identity.name, speaking: false }]
      )

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
  }, [channel, identity, selectedInput])

  const leaveVoice = useCallback(() => {
    if (speakingRafRef.current) cancelAnimationFrame(speakingRafRef.current)
    if (detectionCtxRef.current) { detectionCtxRef.current.close().catch(() => {}); detectionCtxRef.current = null }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch(() => {}); audioCtxRef.current = null }
    rnnoiseNodeRef.current = null
    gateGainRef.current = null
    setMicLevel(0)

    Object.values(playbackNodesRef.current).forEach(({ sourceNode, gainNode }) => {
      try { sourceNode.disconnect(); gainNode.disconnect() } catch {}
    })
    playbackNodesRef.current = {}
    if (playbackCtxRef.current) { playbackCtxRef.current.close().catch(() => {}); playbackCtxRef.current = null }

    if (rawStreamRef.current) { rawStreamRef.current.getTracks().forEach((t) => t.stop()); rawStreamRef.current = null }
    if (processedStreamRef.current) { processedStreamRef.current.getTracks().forEach((t) => t.stop()); processedStreamRef.current = null }

    Object.values(peersRef.current).forEach((pc) => pc.close())
    peersRef.current = {}
    setInVoice(false)
    setVoiceUsers([])

    if (channel) {
      channel.send({ type: 'broadcast', event: 'voice-leave', payload: { id: identity.id } })
    }
    document.querySelectorAll('[id^="voice-audio-"]').forEach((el) => el.remove())
  }, [channel, identity])

  const toggleMute = useCallback(() => {
    if (!rawStreamRef.current) return
    const newMuted = !muted
    rawStreamRef.current.getAudioTracks().forEach((track) => { track.enabled = !newMuted })
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
        channel.send({ type: 'broadcast', event: 'voice-offer', payload: { from: identity.id, to: id, offer } })
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
      channel.send({ type: 'broadcast', event: 'voice-answer', payload: { from: identity.id, to: from, answer } })
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
      if (pc) { try { await pc.addIceCandidate(candidate) } catch {} }
    }

    function handleVoiceLeave(payload) {
      const { id } = payload.payload
      setVoiceUsers((prev) => prev.filter((u) => u.id !== id))
      const pc = peersRef.current[id]
      if (pc) { pc.close(); delete peersRef.current[id] }
      const playbackNode = playbackNodesRef.current[id]
      if (playbackNode) {
        try { playbackNode.sourceNode.disconnect(); playbackNode.gainNode.disconnect() } catch {}
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
    inVoice, muted, voiceUsers, joinVoice, leaveVoice, toggleMute,
    sensitivity, setSensitivity, micLevel,
    outputVolume, setOutputVolume,
    userOutputGains, setUserOutputGain,
    audioDevices, selectedInput, setSelectedInput, selectedOutput, setSelectedOutput,
  }
}

async function createRNNoiseNode(audioCtx) {
  throw new Error('createRNNoiseNode not implemented — see setup notes above')
}