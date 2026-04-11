/**
 * useSettings.tsx — Global settings context and hook for Control Plane user preferences.
 *
 * Persists settings to localStorage via lib/settings.ts. Theme changes are
 * applied to the document root immediately as a side effect.
 *
 * Usage:
 *   const { settings, updateSettings, resetSettings } = useSettings()
 *   updateSettings(s => ({ ...s, theme: 'light' }))
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import {
  DEFAULT_SETTINGS,
  type ControlPlaneSettings,
  loadSettings,
  saveSettings,
} from '../lib/settings'

interface SettingsContextValue {
  settings: ControlPlaneSettings
  updateSettings: (updater: (current: ControlPlaneSettings) => ControlPlaneSettings) => void
  replaceSettings: (next: ControlPlaneSettings) => void
  resetSettings: () => void
}

const SettingsContext = createContext<SettingsContextValue | null>(null)

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<ControlPlaneSettings>(() => loadSettings())

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    if (settings.theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light')
      return
    }
    document.documentElement.removeAttribute('data-theme')
  }, [settings.theme])

  const updateSettings = useCallback((updater: (current: ControlPlaneSettings) => ControlPlaneSettings) => {
    setSettings(current => updater(current))
  }, [])

  const replaceSettings = useCallback((next: ControlPlaneSettings) => {
    setSettings(next)
  }, [])

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS)
  }, [])

  const value = useMemo<SettingsContextValue>(() => ({
    settings,
    updateSettings,
    replaceSettings,
    resetSettings,
  }), [settings, updateSettings, replaceSettings, resetSettings])

  return (
    <SettingsContext.Provider value={value}>
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) {
    throw new Error('useSettings must be used within <SettingsProvider>')
  }
  return ctx
}
