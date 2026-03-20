/* Iranti Control Plane — Embedded Chat Panel */
/* CP-T020: Panel shell — stub UI, no live API calls yet. */
/* PM decisions applied:
 *   - Persistence: in-memory only (no server-side session storage)
 *   - Slash commands: static list of top 10 known commands
 *   - History: retained on view switch (per-tab, not per-view)
 *   - Breakpoint: panel overlays at < 1280px viewport width
 *   - Streaming: stretch goal — full-response rendering is AC
 */

import {
  useState,
  useRef,
  useEffect,
  useCallback,
  type KeyboardEvent,
  type ChangeEvent,
} from 'react'
import { useNavigate } from 'react-router-dom'
import { Spinner } from '../ui/Spinner'
import styles from './ChatPanel.module.css'

/* ------------------------------------------------------------------ */
/*  Types                                                               */
/* ------------------------------------------------------------------ */

type MessageRole = 'user' | 'assistant'

/** A retrieved memory block as returned by Iranti Chat (future, stubbed). */
interface MemoryBlock {
  entityType: string
  entityId: string
  key: string
  summary: string
  confidence: number
  source: string
}

interface ChatMessage {
  id: string
  role: MessageRole
  content: string
  /** Retrieved memory blocks attached to an assistant message, if any. */
  memoryBlocks?: MemoryBlock[]
  createdAt: Date
}

interface ProviderOption {
  id: string
  label: string
}

/* ------------------------------------------------------------------ */
/*  Constants                                                           */
/* ------------------------------------------------------------------ */

const CHAT_PANEL_STORAGE_KEY = 'iranti_cp_chat_panel_open'

const DEFAULT_AGENT_ID = 'operator'

const SLASH_COMMANDS: readonly string[] = [
  '/write',
  '/query',
  '/search',
  '/handshake',
  '/attend',
  '/ingest',
  '/observe',
  '/relate',
  '/who_knows',
  '/clear',
]

const STUB_RESPONSE =
  'Chat integration pending backend confirmation. The backend_developer is investigating the Iranti Chat integration path (Option A: HTTP/SDK vs Option B: subprocess). Once the path is confirmed, this stub will be replaced with live responses.'

/* ------------------------------------------------------------------ */
/*  localStorage helpers                                                */
/* ------------------------------------------------------------------ */

export function loadPanelOpen(): boolean {
  try {
    const stored = localStorage.getItem(CHAT_PANEL_STORAGE_KEY)
    if (stored === 'true') return true
    if (stored === 'false') return false
  } catch {
    // localStorage unavailable — non-fatal
  }
  return false
}

/* ------------------------------------------------------------------ */
/*  Message ID generator                                               */
/* ------------------------------------------------------------------ */

let _msgCounter = 0
function nextMsgId(): string {
  _msgCounter += 1
  return `msg-${Date.now()}-${_msgCounter}`
}

/* ------------------------------------------------------------------ */
/*  Slash command palette                                               */
/* ------------------------------------------------------------------ */

interface SlashPaletteProps {
  query: string
  onSelect: (cmd: string) => void
  onDismiss: () => void
  activeIndex: number
  onActiveIndexChange: (i: number) => void
}

function SlashPalette({
  query,
  onSelect,
  onDismiss,
  activeIndex,
  onActiveIndexChange,
}: SlashPaletteProps) {
  const filtered = SLASH_COMMANDS.filter(c =>
    c.toLowerCase().startsWith(query.toLowerCase()),
  )

  if (filtered.length === 0) return null

  return (
    <div className={styles.slashPalette} role="listbox" aria-label="Slash commands">
      {filtered.map((cmd, i) => (
        <button
          key={cmd}
          role="option"
          aria-selected={i === activeIndex}
          className={`${styles.slashItem} ${i === activeIndex ? styles.slashItemActive : ''}`}
          onMouseDown={(e) => {
            e.preventDefault() // don't blur textarea
            onSelect(cmd)
          }}
          onMouseEnter={() => onActiveIndexChange(i)}
          tabIndex={-1}
          type="button"
        >
          <span className={styles.slashCmd}>{cmd}</span>
        </button>
      ))}
      <div className={styles.slashDismiss}>
        <button
          type="button"
          className={styles.slashDismissBtn}
          onMouseDown={(e) => { e.preventDefault(); onDismiss() }}
          tabIndex={-1}
        >
          Esc to dismiss
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Memory block card                                                   */
/* ------------------------------------------------------------------ */

interface MemoryBlockCardProps {
  block: MemoryBlock
  onViewInExplorer: (entityType: string, entityId: string) => void
}

function MemoryBlockCard({ block, onViewInExplorer }: MemoryBlockCardProps) {
  return (
    <div className={styles.memoryCard} aria-label={`Memory block: ${block.entityType}/${block.entityId}`}>
      <div className={styles.memoryCardHeader}>
        <span className={styles.memoryCardEntity}>
          {block.entityType}/{block.entityId}
        </span>
        <span className={styles.memoryCardKey}>{block.key}</span>
        <span className={styles.memoryCardConfidence} aria-label={`Confidence ${block.confidence}`}>
          {block.confidence}
        </span>
      </div>
      <p className={styles.memoryCardSummary}>{block.summary}</p>
      <div className={styles.memoryCardFooter}>
        <span className={styles.memoryCardSource}>via {block.source}</span>
        <button
          type="button"
          className={styles.memoryCardLink}
          onClick={() => onViewInExplorer(block.entityType, block.entityId)}
        >
          View in Memory Explorer →
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Message bubble                                                      */
/* ------------------------------------------------------------------ */

interface MessageBubbleProps {
  message: ChatMessage
  onViewInExplorer: (entityType: string, entityId: string) => void
}

function MessageBubble({ message, onViewInExplorer }: MessageBubbleProps) {
  return (
    <div
      className={`${styles.message} ${message.role === 'user' ? styles.messageUser : styles.messageAssistant}`}
      aria-label={`${message.role} message`}
    >
      <div className={styles.messageRole}>{message.role === 'user' ? 'you' : 'iranti'}</div>
      <div className={styles.messageContent}>{message.content}</div>
      {message.role === 'assistant' && message.memoryBlocks && message.memoryBlocks.length > 0 && (
        <div className={styles.messageMemoryBlocks} aria-label="Retrieved memory blocks">
          {message.memoryBlocks.map((block) => (
            <MemoryBlockCard
              key={`${block.entityType}/${block.entityId}/${block.key}`}
              block={block}
              onViewInExplorer={onViewInExplorer}
            />
          ))}
        </div>
      )}
      {/* Placeholder div for future memory block cards (always present on assistant messages) */}
      {message.role === 'assistant' && (!message.memoryBlocks || message.memoryBlocks.length === 0) && (
        <div className={styles.messageMemoryBlocksPlaceholder} data-memory-blocks-slot="true" />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Panel header                                                        */
/* ------------------------------------------------------------------ */

interface PanelHeaderProps {
  onClose: () => void
  onClear: () => void
}

function PanelHeader({ onClose, onClear }: PanelHeaderProps) {
  const [clearState, setClearState] = useState<'idle' | 'confirm'>('idle')
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClearClick = () => {
    if (clearState === 'idle') {
      setClearState('confirm')
      clearTimerRef.current = setTimeout(() => {
        setClearState('idle')
      }, 3000)
    } else {
      // Second click within 3 seconds — confirm clear
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
      setClearState('idle')
      onClear()
    }
  }

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current)
    }
  }, [])

  return (
    <div className={styles.panelHeader}>
      <span className={styles.panelTitle}>Iranti Chat</span>
      <div className={styles.panelHeaderActions}>
        <button
          type="button"
          className={`${styles.clearBtn} ${clearState === 'confirm' ? styles.clearBtnConfirm : ''}`}
          onClick={handleClearClick}
          aria-label={clearState === 'confirm' ? 'Confirm: click again to clear conversation' : 'Clear conversation'}
          title={clearState === 'confirm' ? 'Click again to confirm clear' : 'Clear conversation'}
        >
          {clearState === 'confirm' ? 'Confirm clear?' : '✕'}
        </button>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={onClose}
          aria-label="Close chat panel"
          title="Close chat panel"
        >
          ×
        </button>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Provider selector                                                   */
/* ------------------------------------------------------------------ */

interface ProviderSelectorProps {
  providers: ProviderOption[]
  selectedId: string | null
  onSelect: (id: string) => void
  isLoading: boolean
  loadError: boolean
}

function ProviderSelector({
  providers,
  selectedId,
  onSelect,
  isLoading,
  loadError,
}: ProviderSelectorProps) {
  if (isLoading) {
    return (
      <div className={styles.providerRow}>
        <span className={styles.selectorLabel}>provider</span>
        <span className={styles.providerLoading}>Loading…</span>
      </div>
    )
  }

  if (loadError || providers.length === 0) {
    return (
      <div className={styles.providerRow}>
        <span className={styles.selectorLabel}>provider</span>
        <span className={styles.providerEmpty}>No providers configured</span>
      </div>
    )
  }

  return (
    <div className={styles.providerRow}>
      <label htmlFor="chat-provider-select" className={styles.selectorLabel}>
        provider
      </label>
      <select
        id="chat-provider-select"
        className={styles.selectorSelect}
        value={selectedId ?? ''}
        onChange={(e: ChangeEvent<HTMLSelectElement>) => onSelect(e.target.value)}
        aria-label="Select provider for chat session"
      >
        {providers.map(p => (
          <option key={p.id} value={p.id}>{p.label}</option>
        ))}
      </select>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Main ChatPanel component                                            */
/* ------------------------------------------------------------------ */

interface ChatPanelProps {
  isOpen: boolean
  onClose: () => void
}

export function ChatPanel({ isOpen, onClose }: ChatPanelProps) {
  const navigate = useNavigate()

  // ── Conversation state ────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const abortControllerRef = useRef<AbortController | null>(null)

  // ── Agent ID selector ─────────────────────────────────────────────
  const [agentId, setAgentId] = useState<string>(DEFAULT_AGENT_ID)

  // ── Provider selector ─────────────────────────────────────────────
  const [providers, setProviders] = useState<ProviderOption[]>([])
  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null)
  const [providersLoading, setProvidersLoading] = useState(false)
  const [providersError, setProvidersError] = useState(false)

  // ── Message input ─────────────────────────────────────────────────
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ── Slash command palette ─────────────────────────────────────────
  const [slashOpen, setSlashOpen] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)

  // ── Thread scroll ─────────────────────────────────────────────────
  const threadRef = useRef<HTMLDivElement>(null)

  // ── Fetch providers on mount ──────────────────────────────────────
  useEffect(() => {
    setProvidersLoading(true)
    setProvidersError(false)
    fetch('/api/control-plane/providers')
      .then(res => {
        if (!res.ok) throw new Error('Provider fetch failed')
        return res.json() as Promise<{ providers: Array<{ id: string; name: string; isDefault: boolean }> }>
      })
      .then(data => {
        const opts: ProviderOption[] = data.providers.map(p => ({
          id: p.id,
          label: p.name,
        }))
        setProviders(opts)
        // Auto-select the default provider
        const defaultP = data.providers.find(p => p.isDefault)
        const firstP = data.providers[0]
        const selected = defaultP ?? firstP
        if (selected) setSelectedProviderId(selected.id)
      })
      .catch(() => {
        setProvidersError(true)
      })
      .finally(() => {
        setProvidersLoading(false)
      })
  }, [])

  // ── Auto-scroll thread to bottom ──────────────────────────────────
  useEffect(() => {
    if (threadRef.current) {
      threadRef.current.scrollTop = threadRef.current.scrollHeight
    }
  }, [messages])

  // ── Auto-grow textarea ────────────────────────────────────────────
  const growTextarea = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    // max 6 lines: 6 * line-height(20px) + padding(16px)
    const maxHeight = 6 * 20 + 16
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
  }, [])

  useEffect(() => {
    growTextarea()
  }, [inputValue, growTextarea])

  // ── Input change handler ──────────────────────────────────────────
  const handleInputChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value
    setInputValue(val)

    // Slash command palette detection
    if (val.startsWith('/')) {
      setSlashQuery(val)
      setSlashOpen(true)
      setSlashActiveIndex(0)
    } else {
      setSlashOpen(false)
      setSlashQuery('')
    }
  }

  // ── Slash command select ──────────────────────────────────────────
  const handleSlashSelect = (cmd: string) => {
    setInputValue(cmd + ' ')
    setSlashOpen(false)
    setSlashQuery('')
    setSlashActiveIndex(0)
    // Re-focus textarea after selection
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
    })
  }

  // ── Keyboard handler for textarea ─────────────────────────────────
  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashOpen) {
      const filtered = SLASH_COMMANDS.filter(c =>
        c.toLowerCase().startsWith(slashQuery.toLowerCase()),
      )
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSlashActiveIndex(i => Math.min(i + 1, filtered.length - 1))
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSlashActiveIndex(i => Math.max(i - 1, 0))
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        const selected = filtered[slashActiveIndex]
        if (selected) handleSlashSelect(selected)
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setSlashOpen(false)
        return
      }
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void handleSend()
    }
  }

  // ── Send handler ──────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputValue.trim()
    if (!text || isLoading) return

    // Add user message
    const userMsg: ChatMessage = {
      id: nextMsgId(),
      role: 'user',
      content: text,
      createdAt: new Date(),
    }
    setMessages(prev => [...prev, userMsg])
    setInputValue('')
    setSlashOpen(false)

    // Setup AbortController
    const controller = new AbortController()
    abortControllerRef.current = controller

    setIsLoading(true)

    try {
      // Stub: simulate 1s backend call, then show stub response
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 1000)
        controller.signal.addEventListener('abort', () => {
          clearTimeout(t)
          reject(new DOMException('Aborted', 'AbortError'))
        })
      })

      if (!controller.signal.aborted) {
        const assistantMsg: ChatMessage = {
          id: nextMsgId(),
          role: 'assistant',
          content: STUB_RESPONSE,
          memoryBlocks: [],
          createdAt: new Date(),
        }
        setMessages(prev => [...prev, assistantMsg])
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        // Cancelled by user — add a system note
        const cancelMsg: ChatMessage = {
          id: nextMsgId(),
          role: 'assistant',
          content: '(Request cancelled)',
          createdAt: new Date(),
        }
        setMessages(prev => [...prev, cancelMsg])
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }, [inputValue, isLoading])

  // ── Cancel handler ────────────────────────────────────────────────
  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  // ── Clear handler ─────────────────────────────────────────────────
  const handleClear = () => {
    setMessages([])
  }

  // ── View in Memory Explorer ───────────────────────────────────────
  const handleViewInExplorer = useCallback(
    (entityType: string, entityId: string) => {
      navigate(`/memory/${encodeURIComponent(entityType)}/${encodeURIComponent(entityId)}`)
    },
    [navigate],
  )

  // Don't render DOM at all when not open (panel handled by AppShell layout)
  // We render and let the parent control visibility via CSS transform/display.

  return (
    <div
      className={`${styles.panel} ${isOpen ? styles.panelOpen : styles.panelClosed}`}
      aria-label="Iranti Chat panel"
      aria-hidden={!isOpen}
      role="complementary"
    >
      {/* Header */}
      <PanelHeader onClose={onClose} onClear={handleClear} />

      {/* Selectors */}
      <div className={styles.selectors}>
        {/* Agent ID */}
        <div className={styles.agentRow}>
          <label htmlFor="chat-agent-id" className={styles.selectorLabel}>
            agent
          </label>
          <input
            id="chat-agent-id"
            type="text"
            className={styles.agentInput}
            value={agentId}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setAgentId(e.target.value)}
            placeholder="operator"
            spellCheck={false}
            aria-label="Agent ID for chat session"
          />
        </div>

        {/* Provider / model */}
        <ProviderSelector
          providers={providers}
          selectedId={selectedProviderId}
          onSelect={setSelectedProviderId}
          isLoading={providersLoading}
          loadError={providersError}
        />
      </div>

      {/* Conversation thread */}
      <div
        ref={threadRef}
        className={styles.thread}
        role="log"
        aria-live="polite"
        aria-label="Conversation thread"
      >
        {messages.length === 0 && (
          <div className={styles.emptyState}>
            Send a message to start chatting with Iranti.
          </div>
        )}
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            message={msg}
            onViewInExplorer={handleViewInExplorer}
          />
        ))}
        {isLoading && (
          <div className={styles.loadingIndicator} aria-label="Waiting for response">
            <Spinner size="sm" label="Waiting for Iranti response" />
            <span className={styles.loadingText}>Thinking…</span>
          </div>
        )}
      </div>

      {/* Input area */}
      <div className={styles.inputArea}>
        {/* Slash command palette — rendered above the input */}
        {slashOpen && (
          <SlashPalette
            query={slashQuery}
            onSelect={handleSlashSelect}
            onDismiss={() => setSlashOpen(false)}
            activeIndex={slashActiveIndex}
            onActiveIndexChange={setSlashActiveIndex}
          />
        )}

        <div className={styles.inputRow}>
          <textarea
            ref={textareaRef}
            className={styles.textarea}
            value={inputValue}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Message Iranti… (/ for commands)"
            disabled={isLoading}
            rows={1}
            aria-label="Chat message input"
            aria-multiline="true"
            spellCheck
          />
          <div className={styles.inputActions}>
            {isLoading ? (
              <button
                type="button"
                className={styles.cancelBtn}
                onClick={handleCancel}
                aria-label="Cancel in-flight request"
              >
                Cancel
              </button>
            ) : (
              <button
                type="button"
                className={styles.sendBtn}
                onClick={() => void handleSend()}
                disabled={!inputValue.trim()}
                aria-label="Send message"
              >
                ↑
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/*  Chat panel toggle button — rendered in AppShell sidebar footer     */
/* ------------------------------------------------------------------ */

interface ChatToggleButtonProps {
  isOpen: boolean
  onClick: () => void
}

export function ChatToggleButton({ isOpen, onClick }: ChatToggleButtonProps) {
  return (
    <button
      type="button"
      className={`${styles.toggleBtn} ${isOpen ? styles.toggleBtnActive : ''}`}
      onClick={onClick}
      aria-label={isOpen ? 'Close Iranti Chat panel' : 'Open Iranti Chat panel'}
      aria-expanded={isOpen}
      aria-controls="iranti-chat-panel"
      title={isOpen ? 'Close Chat' : 'Open Chat'}
    >
      <span className={styles.toggleBtnIcon} aria-hidden="true">⬡</span>
      <span className={styles.toggleBtnLabel}>Chat</span>
    </button>
  )
}
