import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, MessageCircle, Plus, Search, Send, X } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './Messages.css'

type InboxItem = {
  conversation_id: string
  other_id: string
  full_name: string
  niche: string | null
  community: string | null
  last_message: string | null
  last_message_at: string | null
  last_sender_id: string | null
  last_read_at: string
}

type InboxRpcItem = Omit<InboxItem, 'other_id'> & {
  other_user_id: string
}

type Message = {
  id: string
  conversation_id: string
  sender_id: string
  body: string
  created_at: string
}

type Person = {
  id: string
  full_name: string
  niche: string | null
  community: string | null
}

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

const formatTime = (value: string | null) => {
  if (!value) return ''
  const date = new Date(value)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) {
    return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

export default function Messages() {
  const [authStatus, setAuthStatus] = useState<'loading' | 'ready' | 'signed-out' | 'unconfigured' | 'error'>(
    supabase ? 'loading' : 'unconfigured',
  )
  const [userId, setUserId] = useState('')
  const [inbox, setInbox] = useState<InboxItem[]>([])
  const [activeOtherId, setActiveOtherId] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [inboxLoading, setInboxLoading] = useState(true)
  const [loadedThreadId, setLoadedThreadId] = useState('')
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [inboxFilter, setInboxFilter] = useState('')
  const [composeOpen, setComposeOpen] = useState(false)
  const [peopleSearch, setPeopleSearch] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [peopleLoading, setPeopleLoading] = useState(false)
  const [peopleSearched, setPeopleSearched] = useState(false)
  const threadEndRef = useRef<HTMLDivElement>(null)
  const activeConversation = inbox.find((item) => item.other_id === activeOtherId)
  const activeConversationId = activeConversation?.conversation_id ?? ''

  const loadInbox = useCallback(async (accountId: string) => {
    if (!supabase || !accountId) return
    const client = supabase
    try {
      const { data, error: inboxError } = await client.rpc('get_message_inbox')
      if (inboxError) {
        setError(inboxError.message)
        return
      }

      const rows = ((data ?? []) as InboxRpcItem[]).map(({ other_user_id, ...item }) => ({
        ...item,
        other_id: other_user_id,
      }))
      setInbox(rows)
      setActiveOtherId((current) => current || rows[0]?.other_id || '')
    } catch (inboxError) {
      setError(inboxError instanceof Error ? inboxError.message : 'Could not load your conversations.')
    } finally {
      setInboxLoading(false)
    }
  }, [])

  const refreshInbox = useCallback(async () => loadInbox(userId), [loadInbox, userId])

  const markAsRead = useCallback(async (conversationId: string) => {
    if (!supabase || !userId) return
    const client = supabase
    const readAt = new Date().toISOString()
    try {
      const { error: readError } = await client.from('conversation_participants')
        .update({ last_read_at: readAt })
        .eq('conversation_id', conversationId)
        .eq('user_id', userId)
      if (readError) {
        setError(readError.message)
        return
      }
      setInbox((items) => items.map((item) =>
        item.conversation_id === conversationId ? { ...item, last_read_at: readAt } : item,
      ))
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : 'Could not update the read status.')
    }
  }, [userId])

  useEffect(() => {
    if (!supabase) return
    let current = true
    const client = supabase

    const loadUser = async () => {
      try {
        const { data, error: authError } = await client.auth.getUser()
        if (!current) return
        if (authError) {
          setError(authError.message)
          setAuthStatus('error')
        } else if (data.user) {
          setUserId(data.user.id)
          setAuthStatus('ready')
          await loadInbox(data.user.id)
        } else {
          setAuthStatus('signed-out')
        }
      } catch (authError) {
        if (!current) return
        setError(authError instanceof Error ? authError.message : 'Could not load your account.')
        setAuthStatus('error')
      }
    }

    void loadUser()
    return () => { current = false }
  }, [loadInbox])

  useEffect(() => {
    if (!supabase || !userId) return
    const client = supabase
    const channel = client
      .channel(`message-updates:${userId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages' }, (payload) => {
        const conversationId = typeof payload.new.conversation_id === 'string' ? payload.new.conversation_id : ''
        if (!conversationId) return
        void refreshInbox().then(() => {
          if (conversationId === activeConversationId) void markAsRead(conversationId)
        })
        if (conversationId === activeConversationId) {
          void client.from('messages')
            .select('id, conversation_id, sender_id, body, created_at')
            .eq('conversation_id', conversationId)
            .order('created_at', { ascending: true })
            .limit(250)
            .then(({ data, error: messageError }) => {
              if (messageError) setError(messageError.message)
              else setMessages((data ?? []) as Message[])
            }, (messageError: unknown) => {
              setError(messageError instanceof Error ? messageError.message : 'Could not refresh this conversation.')
            })
        }
      })
      .subscribe()

    return () => { void client.removeChannel(channel) }
  }, [activeConversationId, markAsRead, refreshInbox, userId])

  useEffect(() => {
    if (!supabase || !userId || !activeConversationId) return

    const client = supabase
    let current = true
    const loadThread = async () => {
      try {
        const { data, error: threadError } = await client.from('messages')
          .select('id, conversation_id, sender_id, body, created_at')
          .eq('conversation_id', activeConversationId)
          .order('created_at', { ascending: true })
          .limit(250)

        if (!current) return
        if (threadError) {
          setError(threadError.message)
          setMessages([])
          setLoadedThreadId(activeConversationId)
          return
        }
        setMessages((data ?? []) as Message[])
        setLoadedThreadId(activeConversationId)
        await markAsRead(activeConversationId)
      } catch (threadError) {
        if (!current) return
        setError(threadError instanceof Error ? threadError.message : 'Could not load this conversation.')
        setMessages([])
        setLoadedThreadId(activeConversationId)
      }
    }

    void loadThread()
    return () => { current = false }
  }, [activeConversationId, markAsRead, userId])

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [messages])

  const handleSearchPeople = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !peopleSearch.trim()) return
    const client = supabase
    setError('')
    setPeopleLoading(true)
    setPeopleSearched(true)
    try {
      const { data, error: searchError } = await client.rpc('search_message_people', {
        search_text: peopleSearch.trim(),
      })
      if (searchError) {
        setError(searchError.message)
        return
      }
      setPeople((data ?? []) as Person[])
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : 'Could not search for people.')
    } finally {
      setPeopleLoading(false)
    }
  }

  const startConversation = async (person: Person) => {
    if (!supabase) return
    const client = supabase
    setError('')
    try {
      const { data, error: startError } = await client.rpc('start_direct_conversation', {
        other_user_id: person.id,
      })
      if (startError) {
        setError(startError.message)
        return
      }
      if (typeof data !== 'string') {
        setError('Could not open this conversation. Please try again.')
        return
      }
      setComposeOpen(false)
      setPeopleSearch('')
      setPeople([])
      setPeopleSearched(false)
      setActiveOtherId(person.id)
      await refreshInbox()
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : 'Could not open this conversation.')
    }
  }

  const sendMessage = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const body = draft.trim()
    if (!supabase || !userId || !activeConversationId || !body || sending) return
    const client = supabase
    setError('')
    setSending(true)
    try {
      const { error: sendError } = await client.from('messages').insert({
        conversation_id: activeConversationId,
        sender_id: userId,
        body,
      })
      if (sendError) {
        setError(sendError.message)
        return
      }
      setDraft('')
      await refreshInbox()
      const { data, error: threadError } = await client.from('messages')
        .select('id, conversation_id, sender_id, body, created_at')
        .eq('conversation_id', activeConversationId)
        .order('created_at', { ascending: true })
        .limit(250)
      if (threadError) setError(threadError.message)
      else setMessages((data ?? []) as Message[])
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Could not send this message.')
    } finally {
      setSending(false)
    }
  }

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const threadLoading = !!activeOtherId
    && (!activeConversation || loadedThreadId !== activeConversationId)
  const visibleInbox = inbox.filter((item) =>
    item.full_name.toLowerCase().includes(inboxFilter.toLowerCase().trim()),
  )

  if (authStatus === 'loading') {
    return <div className="messages-state"><p>Loading messages…</p></div>
  }

  if (authStatus === 'unconfigured') {
    return (
      <div className="messages-state card">
        <MessageCircle size={32} />
        <h1>Messages need a connection</h1>
        <p>Connect this app to Supabase and apply the direct-messages migration to enable chats.</p>
      </div>
    )
  }

  if (authStatus === 'signed-out') {
    return (
      <div className="messages-state card">
        <MessageCircle size={32} />
        <h1>Sign in to see your messages</h1>
        <p>Your conversations are available after you sign in.</p>
        <Link className="btn btn-primary" to="/auth">Log in</Link>
      </div>
    )
  }

  if (authStatus === 'error') {
    return <div className="alert alert-error" role="alert">{error || 'Could not load messages.'}</div>
  }

  return (
    <section className="messages-page">
      <header className="messages-heading">
        <div>
          <p className="messages-eyebrow">Your inbox</p>
          <h1>Messages</h1>
        </div>
        <button className="btn btn-primary messages-new-button" type="button" onClick={() => setComposeOpen((open) => !open)}>
          {composeOpen ? <X size={18} /> : <Plus size={18} />}
          {composeOpen ? 'Close' : 'New message'}
        </button>
      </header>

      {error && <p className="alert alert-error messages-alert" role="alert">{error}</p>}

      <div className="messenger">
        <aside className={`conversation-list${activeOtherId ? ' message-pane-mobile-hidden' : ''}`} aria-label="Conversations">
          {composeOpen && (
            <section className="compose-panel">
              <form className="compose-search" onSubmit={handleSearchPeople}>
                <label htmlFor="people-search">Start a conversation</label>
                <div className="compose-search-row">
                  <input
                    id="people-search"
                    type="search"
                    value={peopleSearch}
                    onChange={(event) => setPeopleSearch(event.target.value)}
                    placeholder="Search people by name"
                  />
                  <button className="btn btn-primary" type="submit" disabled={peopleLoading || !peopleSearch.trim()} aria-label="Search people">
                    <Search size={18} />
                  </button>
                </div>
              </form>
              {peopleLoading && <p className="muted">Searching people…</p>}
              {!peopleLoading && peopleSearched && people.length === 0 && <p className="muted">No matching people found.</p>}
              <div className="people-results">
                {people.map((person) => (
                  <button className="person-result" key={person.id} type="button" onClick={() => void startConversation(person)}>
                    <span className="message-avatar">{initials(person.full_name)}</span>
                    <span className="person-result-copy">
                      <strong>{person.full_name}</strong>
                      <small>{[person.niche, person.community].filter(Boolean).join(' · ') || 'TOL member'}</small>
                    </span>
                  </button>
                ))}
              </div>
            </section>
          )}

          <div className="inbox-tools">
            <h2>Chats</h2>
            <label className="inbox-search">
              <Search size={17} aria-hidden="true" />
              <input
                type="search"
                value={inboxFilter}
                onChange={(event) => setInboxFilter(event.target.value)}
                placeholder="Search conversations"
                aria-label="Search conversations"
              />
            </label>
          </div>

          {inboxLoading && inbox.length === 0 && <p className="inbox-empty">Loading conversations…</p>}
          {!inboxLoading && visibleInbox.length === 0 && (
            <div className="inbox-empty">
              <MessageCircle size={25} />
              <p>{inbox.length ? 'No conversations match that search.' : 'No messages yet. Start a conversation with someone in the community.'}</p>
              {!inbox.length && (
                <button className="btn btn-secondary btn-sm" type="button" onClick={() => setComposeOpen(true)}>
                  Find someone
                </button>
              )}
            </div>
          )}

          <div className="conversation-items">
            {visibleInbox.map((item) => {
              const unread = item.last_sender_id !== userId
                && !!item.last_message_at
                && new Date(item.last_message_at) > new Date(item.last_read_at)
              return (
                <button
                  className={`conversation-item${activeOtherId === item.other_id ? ' conversation-item-active' : ''}`}
                  key={item.other_id}
                  type="button"
                  onClick={() => setActiveOtherId(item.other_id)}
                >
                  <span className="message-avatar">{initials(item.full_name)}</span>
                  <span className="conversation-copy">
                    <span className="conversation-title-row">
                      <strong>{item.full_name}</strong>
                      <time>{formatTime(item.last_message_at)}</time>
                    </span>
                    <span className="conversation-preview">
                      {item.last_message || 'Start your conversation'}
                    </span>
                  </span>
                  {unread && <span className="unread-dot" aria-label="Unread message" />}
                </button>
              )
            })}
          </div>
        </aside>

        <section className={`conversation-thread${!activeOtherId ? ' message-pane-mobile-hidden' : ''}`} aria-label="Chat">
          {activeOtherId ? (
            <>
              <header className="thread-header">
                <button className="thread-back" type="button" onClick={() => setActiveOtherId('')} aria-label="Back to conversations">
                  <ArrowLeft size={20} />
                </button>
                <span className="message-avatar">{initials(activeConversation?.full_name || 'TOL member')}</span>
                <div className="thread-person">
                  <h2>{activeConversation?.full_name || 'Conversation'}</h2>
                  <p>{[activeConversation?.niche, activeConversation?.community].filter(Boolean).join(' · ') || 'The One Living'}</p>
                </div>
              </header>

              <div className="thread-messages" aria-live="polite">
                {threadLoading && <p className="thread-notice">Loading messages…</p>}
                {!threadLoading && messages.length === 0 && (
                  <div className="thread-welcome">
                    <span className="message-avatar message-avatar-large">{initials(activeConversation?.full_name || 'TOL member')}</span>
                    <h3>{activeConversation?.full_name || 'Your conversation'}</h3>
                    <p>Send a message to start the conversation.</p>
                  </div>
                )}
                {!threadLoading && messages.map((message) => {
                  const ownMessage = message.sender_id === userId
                  return (
                    <div className={`message-row${ownMessage ? ' message-row-own' : ''}`} key={message.id}>
                      <div className="message-bubble">
                        <p>{message.body}</p>
                        <time>{formatTime(message.created_at)}</time>
                      </div>
                    </div>
                  )
                })}
                <div ref={threadEndRef} />
              </div>

              <form className="message-composer" onSubmit={sendMessage}>
                <textarea
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  onKeyDown={handleDraftKeyDown}
                  placeholder="Write a message…"
                  aria-label="Write a message"
                  maxLength={5000}
                  rows={1}
                />
                <button className="btn btn-primary send-button" type="submit" disabled={!draft.trim() || sending} aria-label="Send message">
                  <Send size={18} />
                  <span>{sending ? 'Sending…' : 'Send'}</span>
                </button>
              </form>
            </>
          ) : (
            <div className="thread-placeholder">
              <MessageCircle size={38} />
              <h2>Your messages</h2>
              <p>Choose a chat or start a new conversation with someone in the community.</p>
            </div>
          )}
        </section>
      </div>
    </section>
  )
}
