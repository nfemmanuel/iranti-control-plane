export type LandingPage =
  | '/overview'
  | '/instances'
  | '/health'
  | '/providers'
  | '/getting-started'
  | '/sessions'

export type CommandRunnerMode = 'copy_and_run' | 'copy_only'
export type PollIntervalMs = 30000 | 60000 | 300000
export type DatabaseMode = 'compose' | 'url'

export interface ControlPlaneSettings {
  theme: 'dark' | 'light'
  landingPage: LandingPage
  chatPanelOpen: boolean
  showSetupBanner: boolean
  commandRunnerMode: CommandRunnerMode
  healthPollIntervalMs: PollIntervalMs
  createInstanceDefaults: {
    startPort: number
    provider: string
    databaseMode: DatabaseMode
    dbHost: string
    dbPort: string
    dbUser: string
    dbNamePrefix: string
  }
}

export const SETTINGS_STORAGE_KEY = 'iranti_cp_settings_v1'
export const LEGACY_THEME_KEY = 'iranti-cp-theme'
export const LEGACY_CHAT_PANEL_KEY = 'iranti_cp_chat_panel_open'
export const SETUP_DISMISSED_KEY = 'iranti_cp_setup_dismissed'
export const SETUP_COMPLETE_KEY = 'iranti_setup_complete'

function preferredLocalDbHost(): string {
  if (typeof navigator === 'undefined') return 'localhost'
  return /win/i.test(navigator.userAgent) ? '127.0.0.1' : 'localhost'
}

export const DEFAULT_SETTINGS: ControlPlaneSettings = {
  theme: 'dark',
  landingPage: '/overview',
  chatPanelOpen: false,
  showSetupBanner: true,
  commandRunnerMode: 'copy_and_run',
  healthPollIntervalMs: 60000,
  createInstanceDefaults: {
    startPort: 3001,
    provider: 'claude',
    databaseMode: 'compose',
    dbHost: preferredLocalDbHost(),
    dbPort: '5432',
    dbUser: 'postgres',
    dbNamePrefix: 'iranti_',
  },
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sanitizeLandingPage(value: unknown): LandingPage {
  switch (value) {
    case '/instances':
    case '/health':
    case '/providers':
    case '/getting-started':
    case '/sessions':
    case '/overview':
      return value
    default:
      return DEFAULT_SETTINGS.landingPage
  }
}

function sanitizeCommandRunnerMode(value: unknown): CommandRunnerMode {
  return value === 'copy_only' ? 'copy_only' : 'copy_and_run'
}

function sanitizePollInterval(value: unknown): PollIntervalMs {
  return value === 30000 || value === 300000 ? value : 60000
}

function sanitizePort(value: unknown): number {
  const parsed = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(parsed) || parsed < 1024 || parsed > 65535) {
    return DEFAULT_SETTINGS.createInstanceDefaults.startPort
  }
  return parsed
}

function sanitizeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function sanitizeDatabaseMode(value: unknown): DatabaseMode {
  return value === 'url' ? 'url' : 'compose'
}

export function sanitizeSettings(raw: unknown): ControlPlaneSettings {
  const parsed = isRecord(raw) ? raw : {}
  const createDefaults = isRecord(parsed['createInstanceDefaults']) ? parsed['createInstanceDefaults'] : {}

  return {
    theme: parsed['theme'] === 'light' ? 'light' : 'dark',
    landingPage: sanitizeLandingPage(parsed['landingPage']),
    chatPanelOpen: parsed['chatPanelOpen'] === true,
    showSetupBanner: parsed['showSetupBanner'] !== false,
    commandRunnerMode: sanitizeCommandRunnerMode(parsed['commandRunnerMode']),
    healthPollIntervalMs: sanitizePollInterval(parsed['healthPollIntervalMs']),
    createInstanceDefaults: {
      startPort: sanitizePort(createDefaults['startPort']),
      provider: sanitizeString(createDefaults['provider'], DEFAULT_SETTINGS.createInstanceDefaults.provider),
      databaseMode: sanitizeDatabaseMode(createDefaults['databaseMode']),
      dbHost: sanitizeString(createDefaults['dbHost'], DEFAULT_SETTINGS.createInstanceDefaults.dbHost),
      dbPort: sanitizeString(createDefaults['dbPort'], DEFAULT_SETTINGS.createInstanceDefaults.dbPort),
      dbUser: sanitizeString(createDefaults['dbUser'], DEFAULT_SETTINGS.createInstanceDefaults.dbUser),
      dbNamePrefix: sanitizeString(createDefaults['dbNamePrefix'], DEFAULT_SETTINGS.createInstanceDefaults.dbNamePrefix),
    },
  }
}

export function loadSettings(): ControlPlaneSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY)
    if (raw) {
      return sanitizeSettings(JSON.parse(raw))
    }
  } catch {
    // fall through to legacy migration/defaults
  }

  let theme = DEFAULT_SETTINGS.theme
  let chatPanelOpen = DEFAULT_SETTINGS.chatPanelOpen

  try {
    const legacyTheme = localStorage.getItem(LEGACY_THEME_KEY)
    if (legacyTheme === 'light' || legacyTheme === 'dark') {
      theme = legacyTheme
    }
    const legacyChat = localStorage.getItem(LEGACY_CHAT_PANEL_KEY)
    if (legacyChat === 'true') {
      chatPanelOpen = true
    } else if (legacyChat === 'false') {
      chatPanelOpen = false
    }
  } catch {
    // ignore legacy migration failures
  }

  return {
    ...DEFAULT_SETTINGS,
    theme,
    chatPanelOpen,
  }
}

export function saveSettings(settings: ControlPlaneSettings): void {
  const next = sanitizeSettings(settings)
  localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next))
  localStorage.setItem(LEGACY_THEME_KEY, next.theme)
  localStorage.setItem(LEGACY_CHAT_PANEL_KEY, String(next.chatPanelOpen))
}

export function clearSetupGuideFlags(): void {
  localStorage.removeItem(SETUP_DISMISSED_KEY)
  localStorage.removeItem(SETUP_COMPLETE_KEY)
}
