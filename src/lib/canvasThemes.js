export const CANVAS_THEMES = {
  midnight: {
    name: 'Midnight',
    bg: '#0a0a12',
    canvasBg: '#0d0d16',
    panelBg: '#0e0e18',
    border: '#1a1a2a',
    accent: '#7c6ef5',
  },
  deepBlue: {
    name: 'Deep blue',
    bg: '#06101f',
    canvasBg: '#081428',
    panelBg: '#0a1730',
    border: '#162840',
    accent: '#3b82f6',
  },
  forest: {
    name: 'Forest',
    bg: '#0a140f',
    canvasBg: '#0d1812',
    panelBg: '#0f1c15',
    border: '#1a2e22',
    accent: '#34d399',
  },
  warm: {
    name: 'Warm',
    bg: '#160e0a',
    canvasBg: '#1a110c',
    panelBg: '#1c130e',
    border: '#2e1f16',
    accent: '#f59e0b',
  },
}

export function getStoredTheme() {
  return localStorage.getItem('syncboard-theme') || 'midnight'
}

export function setStoredTheme(key) {
  localStorage.setItem('syncboard-theme', key)
}