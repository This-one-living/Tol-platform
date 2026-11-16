import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, MessageCircle, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './Connections.css'

type ConnectionProfile = {
  user_id: string
  full_name: string
  phone: string | null
  lga: string | null
  niche: string | null
  skills: string[]
  interests: string[]
}

type PageStatus = 'loading' | 'ready' | 'signed-out' | 'unconfigured' | 'error'

export default function Connections() {
  const [status, setStatus] = useState<PageStatus>(supabase ? 'loading' : 'unconfigured')
  const [connections, setConnections] = useState<ConnectionProfile[]>([])
  const [selected, setSelected] = useState<ConnectionProfile | null>(null)
  const [error, setError] = useState('')
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    if (!supabase) return
    let active = true
    const client = supabase

    const loadConnections = async () => {
      try {
        const { data: userData, error: authError } = await client.auth.getUser()
        if (!active) return
        if (authError) {
          setError(authError.message)
          setStatus('error')
          return
        }
        if (!userData.user) {
          setStatus('signed-out')
          return
        }

        const { data, error: connectionsError } = await client.rpc('get_my_connections')
        if (!active) return
        if (connectionsError) {
          setError(connectionsError.message)
          setStatus('error')
          return
        }

        setConnections((data ?? []) as ConnectionProfile[])
        setStatus('ready')
      } catch (loadError) {
        if (!active) return
        setError(loadError instanceof Error ? loadError.message : 'Could not load your connections.')
        setStatus('error')
      }
    }

    void loadConnections()
    return () => { active = false }
  }, [])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    if (selected && !dialog.open) dialog.showModal()
    else if (!selected && dialog.open) dialog.close()
  }, [selected])

  const closeProfile = () => {
    dialogRef.current?.close()
    setSelected(null)
  }

  return (
    <section className="connections-page">
      <header className="connections-heading">
        <div>
          <p className="connections-eyebrow">YOUR NETWORK</p>
          <h1>Connections</h1>
          <p className="muted">People you’ve connected with in The One Living.</p>
        </div>
      </header>

      {status === 'unconfigured' && (
        <p className="alert alert-error" role="alert">Connections need a connection to the account database.</p>
      )}
      {status === 'signed-out' && (
        <p className="alert alert-error" role="alert"><Link to="/auth">Log in</Link> to view your connections.</p>
      )}
      {status === 'error' && <p className="alert alert-error" role="alert">{error || 'Could not load your connections.'}</p>}

      {status === 'loading' && <p className="muted" role="status">Loading your connections…</p>}
      {status === 'ready' && connections.length === 0 && (
        <div className="connections-empty card">
          <span className="connections-empty-icon"><MessageCircle size={24} /></span>
          <h2>Your network starts here</h2>
          <p className="muted">When you accept or receive a connection, you’ll find that person here.</p>
          <Link to="/discover" className="btn btn-primary">Discover people</Link>
        </div>
      )}
      {status === 'ready' && connections.length > 0 && (
        <div className="connections-grid">
          {connections.map((connection) => (
            <button
              className="connection-card card"
              key={connection.user_id}
              type="button"
              onClick={() => setSelected(connection)}
              aria-label={`View ${connection.full_name}'s profile`}
            >
              <span className="connection-card-copy">
                <strong>{connection.full_name}</strong>
                <span>{[connection.niche, connection.lga].filter(Boolean).join(' · ') || 'TOL member'}</span>
              </span>
              <ArrowUpRight size={19} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      <dialog
        ref={dialogRef}
        className="connection-dialog"
        aria-labelledby="connection-dialog-name"
        onClose={() => setSelected(null)}
        onClick={(event) => {
          if (event.target === event.currentTarget) closeProfile()
        }}
      >
        {selected && (
          <div className="connection-dialog-content">
            <div className="connection-dialog-heading">
              <h2 id="connection-dialog-name">{selected.full_name}</h2>
              <button className="connection-dialog-close" type="button" onClick={closeProfile} aria-label="Close profile">
                <X size={20} />
              </button>
            </div>

            <dl className="connection-details">
              <div>
                <dt>LGA</dt>
                <dd>{selected.lga || 'Not listed'}</dd>
              </div>
              <div>
                <dt>Niche</dt>
                <dd>{selected.niche || 'Not listed'}</dd>
              </div>
              <div>
                <dt>Skills</dt>
                <dd>{selected.skills?.length ? selected.skills.join(', ') : 'Not listed'}</dd>
              </div>
              <div>
                <dt>Interests</dt>
                <dd>{selected.interests?.length ? selected.interests.join(', ') : 'Not listed'}</dd>
              </div>
              {selected.phone && (
                <div>
                  <dt>Phone</dt>
                  <dd><a href={`tel:${selected.phone}`}>{selected.phone}</a></dd>
                </div>
              )}
            </dl>

            <Link
              className="btn btn-primary connection-chat-button"
              to={`/messages?with=${encodeURIComponent(selected.user_id)}`}
            >
              <MessageCircle size={18} />
              Chat
            </Link>
          </div>
        )}
      </dialog>
    </section>
  )
}
