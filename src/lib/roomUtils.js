const ADJECTIVES = ['Swift', 'Bright', 'Calm', 'Bold', 'Wise', 'Quick', 'Sharp', 'Cool', 'Wild', 'Free']
const ANIMALS = ['Fox', 'Wolf', 'Hawk', 'Bear', 'Lynx', 'Owl', 'Falcon', 'Tiger', 'Otter', 'Raven']
const COLORS = ['#7c6ef5', '#60a5fa', '#4ade80', '#f59e0b', '#f472b6', '#34d399', '#fb923c', '#a78bfa']

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export function generateGuestName() {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const animal = ANIMALS[Math.floor(Math.random() * ANIMALS.length)]
  return `${adj} ${animal}`
}

export function generateGuestColor() {
  return COLORS[Math.floor(Math.random() * COLORS.length)]
}

export function getOrCreateIdentity() {
  let identity = sessionStorage.getItem('syncboard-identity')
  if (identity) return JSON.parse(identity)

  identity = {
    id: crypto.randomUUID(),
    name: generateGuestName(),
    color: generateGuestColor(),
  }
  sessionStorage.setItem('syncboard-identity', JSON.stringify(identity))
  return identity
}

export function updateIdentityName(newName) {
  const identity = getOrCreateIdentity()
  identity.name = newName.trim().slice(0, 20) || identity.name
  sessionStorage.setItem('syncboard-identity', JSON.stringify(identity))
  return identity
}