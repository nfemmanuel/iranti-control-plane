/* Iranti Control Plane — Instance Context */
/* Provides the currently active Iranti instance to all child route views. */
/* CP-T013 through CP-T016 read active instance from this context. */
/* Instance list fetched from /api/control-plane/instances (CP-T011). */
/* Falls back to a stub "local" instance if CP-T011 is not yet ready. */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react'
import { fetchInstances, type Instance } from '../api/instances'

/* ------------------------------------------------------------------ */
/*  Context shape                                                        */
/* ------------------------------------------------------------------ */

interface InstanceContextValue {
  /** Currently selected instance. Null while loading or on error. */
  activeInstance: Instance | null
  /** Full list of known instances. Empty while loading. */
  instances: Instance[]
  /** True while the initial fetch is in flight. */
  loading: boolean
  /** Non-null if the fetch failed. */
  error: string | null
  /** Switch the active instance. Updates context; does not persist to server. */
  setActiveInstance: (instance: Instance) => void
  /** Re-fetch the instance list from the API. */
  refetch: () => void
}

/* ------------------------------------------------------------------ */
/*  Context                                                             */
/* ------------------------------------------------------------------ */

const InstanceContext = createContext<InstanceContextValue | null>(null)

/* ------------------------------------------------------------------ */
/*  Stub instance — used when CP-T011 is not yet ready                 */
/* ------------------------------------------------------------------ */

const STUB_INSTANCE: Instance = {
  id: 'local',
  name: 'local',
  port: 3001,
  host: 'localhost',
  status: 'running',
}

/* ------------------------------------------------------------------ */
/*  Provider                                                            */
/* ------------------------------------------------------------------ */

export function InstanceProvider({ children }: { children: ReactNode }) {
  const [instances, setInstances] = useState<Instance[]>([])
  const [activeInstance, setActiveInstance] = useState<Instance | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadInstances = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const fetched = await fetchInstances()
      setInstances(fetched)
      // Preserve the current active selection if still valid, otherwise pick first
      setActiveInstance(prev => {
        if (prev && fetched.some(i => i.id === prev.id)) return prev
        return fetched[0] ?? STUB_INSTANCE
      })
    } catch (err) {
      // CP-T011 not yet ready — fall back to stub instance with error logged
      const message = err instanceof Error ? err.message : 'Unknown error fetching instances'
      setError(message)
      // Ensure the UI is still operable with a stub instance
      setInstances([STUB_INSTANCE])
      setActiveInstance(prev => prev ?? STUB_INSTANCE)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadInstances()
  }, [loadInstances])

  return (
    <InstanceContext.Provider
      value={{
        activeInstance,
        instances,
        loading,
        error,
        setActiveInstance,
        refetch: loadInstances,
      }}
    >
      {children}
    </InstanceContext.Provider>
  )
}

/* ------------------------------------------------------------------ */
/*  Consumer hook                                                       */
/* ------------------------------------------------------------------ */

export function useInstanceContext(): InstanceContextValue {
  const ctx = useContext(InstanceContext)
  if (!ctx) {
    throw new Error('useInstanceContext must be used within <InstanceProvider>')
  }
  return ctx
}
