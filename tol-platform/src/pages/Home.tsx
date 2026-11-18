import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Heart, MessageCircle, Send, Share2, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './Home.css'

type FeedPost = {
  id: string
  body: string
  author_id: string
  author_name: string
  author_avatar: string | null
  created_at: string
  like_count: number
  comment_count: number
  share_count: number
  liked_by_me: boolean
}

type FeedComment = {
  id: string
  author_id: string
  author_name: string
  author_avatar: string | null
  body: string
  created_at: string
}

type PageStatus = 'loading' | 'ready' | 'signed-out' | 'unconfigured' | 'error'

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join('').toUpperCase()

const formatDate = (value: string) =>
  new Date(value).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' })

export default function Home() {
  const [status, setStatus] = useState<PageStatus>(supabase ? 'loading' : 'unconfigured')
  const [userId, setUserId] = useState('')
  const [posts, setPosts] = useState<FeedPost[]>([])
  const [comments, setComments] = useState<Record<string, FeedComment[]>>({})
  const [openComments, setOpenComments] = useState<string[]>([])
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({})
  const [postDraft, setPostDraft] = useState('')
  const [postBusy, setPostBusy] = useState(false)
  const [busyAction, setBusyAction] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadFeed = useCallback(async () => {
    if (!supabase) return
    const { data, error: feedError } = await supabase.rpc('list_social_feed', {
      p_limit: 30,
      p_offset: 0,
    })
    if (feedError) {
      setError(feedError.message)
      setStatus('error')
      return
    }
    setPosts((data ?? []) as FeedPost[])
    setStatus('ready')
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    const client = supabase

    const initialize = async () => {
      const { data, error: authError } = await client.auth.getUser()
      if (!active) return
      if (authError) {
        setError(authError.message)
        setStatus('error')
      } else if (!data.user) {
        setStatus('signed-out')
      } else {
        setUserId(data.user.id)
        const { data: feedData, error: feedError } = await client.rpc('list_social_feed', {
          p_limit: 30,
          p_offset: 0,
        })
        if (!active) return
        if (feedError) {
          setError(feedError.message)
          setStatus('error')
        } else {
          setPosts((feedData ?? []) as FeedPost[])
          setStatus('ready')
        }
      }
    }

    void initialize().catch((loadError: unknown) => {
      if (!active) return
      setError(loadError instanceof Error ? loadError.message : 'Could not load the community feed.')
      setStatus('error')
    })
    return () => { active = false }
  }, [])

  const createPost = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !postDraft.trim() || postBusy) return
    setPostBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: createError } = await supabase.rpc('create_social_post', { p_body: postDraft })
      if (createError) {
        setError(createError.message)
        return
      }
      setPostDraft('')
      setNotice('Your post has been published.')
      await loadFeed()
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not publish your post.')
    } finally {
      setPostBusy(false)
    }
  }

  const toggleLike = async (post: FeedPost) => {
    if (!supabase || busyAction) return
    setBusyAction(`like:${post.id}`)
    setError('')
    try {
      const { error: likeError } = await supabase.rpc('toggle_social_post_like', { p_post: post.id })
      if (likeError) {
        setError(likeError.message)
        return
      }
      setPosts((current) => current.map((item) => item.id === post.id
        ? { ...item, liked_by_me: !item.liked_by_me, like_count: Math.max(0, item.like_count + (item.liked_by_me ? -1 : 1)) }
        : item,
      ))
    } catch (likeError) {
      setError(likeError instanceof Error ? likeError.message : 'Could not update the like.')
    } finally {
      setBusyAction('')
    }
  }

  const toggleComments = async (postId: string) => {
    if (openComments.includes(postId)) {
      setOpenComments((current) => current.filter((id) => id !== postId))
      return
    }
    if (!supabase) return
    setBusyAction(`comments:${postId}`)
    setError('')
    try {
      const { data, error: commentsError } = await supabase.rpc('list_social_comments', { p_post: postId })
      if (commentsError) {
        setError(commentsError.message)
        return
      }
      setComments((current) => ({ ...current, [postId]: (data ?? []) as FeedComment[] }))
      setOpenComments((current) => [...current, postId])
    } catch (commentsError) {
      setError(commentsError instanceof Error ? commentsError.message : 'Could not load comments.')
    } finally {
      setBusyAction('')
    }
  }

  const createComment = async (event: FormEvent<HTMLFormElement>, postId: string) => {
    event.preventDefault()
    const body = commentDrafts[postId]?.trim() ?? ''
    if (!supabase || !body || busyAction) return
    setBusyAction(`comment:${postId}`)
    setError('')
    try {
      const { error: createError } = await supabase.rpc('create_social_comment', {
        p_post: postId,
        p_body: body,
      })
      if (createError) {
        setError(createError.message)
        return
      }
      setCommentDrafts((current) => ({ ...current, [postId]: '' }))
      const { data, error: commentsError } = await supabase.rpc('list_social_comments', { p_post: postId })
      if (commentsError) {
        setError(commentsError.message)
        return
      }
      setComments((current) => ({ ...current, [postId]: (data ?? []) as FeedComment[] }))
      setPosts((current) => current.map((post) => post.id === postId
        ? { ...post, comment_count: post.comment_count + 1 }
        : post,
      ))
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not add your comment.')
    } finally {
      setBusyAction('')
    }
  }

  const sharePost = async (post: FeedPost) => {
    if (!supabase || busyAction) return
    setBusyAction(`share:${post.id}`)
    setError('')
    setNotice('')
    const url = `${window.location.origin}/home?post=${encodeURIComponent(post.id)}`
    try {
      if (navigator.share) {
        await navigator.share({ title: 'This One Living', text: post.body, url })
      } else {
        await navigator.clipboard.writeText(url)
        setNotice('Post link copied to your clipboard.')
      }
      const { data, error: shareError } = await supabase.rpc('share_social_post', { p_post: post.id })
      if (shareError) {
        setError(shareError.message)
        return
      }
      if (!data) setNotice('You have already shared this post.')
      setPosts((current) => current.map((item) => item.id === post.id
        ? { ...item, share_count: data ? item.share_count + 1 : item.share_count }
        : item,
      ))
    } catch (shareError) {
      if (shareError instanceof DOMException && shareError.name === 'AbortError') return
      setError(shareError instanceof Error ? shareError.message : 'Could not share this post.')
    } finally {
      setBusyAction('')
    }
  }

  const deletePost = async (postId: string) => {
    if (!supabase || busyAction) return
    if (!window.confirm('Delete this post?')) return
    setBusyAction(`delete:${postId}`)
    setError('')
    try {
      const { error: deleteError } = await supabase.rpc('delete_own_social_post', { p_post: postId })
      if (deleteError) {
        setError(deleteError.message)
        return
      }
      setPosts((current) => current.filter((post) => post.id !== postId))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not delete the post.')
    } finally {
      setBusyAction('')
    }
  }

  if (status === 'loading') return <div className="feed-state" role="status">Loading your feed…</div>

  if (status === 'unconfigured') {
    return (
      <div className="feed-state card">
        <h1>Home feed is unavailable</h1>
        <p>Connect this app to Supabase and apply the social feed migration to view and create posts.</p>
      </div>
    )
  }

  if (status === 'signed-out') {
    return (
      <div className="feed-state card">
        <h1>Sign in to view the feed</h1>
        <p>Share useful ideas and join the conversation with the TOL community.</p>
        <Link className="btn btn-primary" to="/auth">Log in</Link>
      </div>
    )
  }

  if (status === 'error') {
    return <p className="alert alert-error" role="alert">{error || 'Could not load the community feed.'}</p>
  }

  return (
    <section className="feed-page">
      <header className="feed-heading">
        <div>
          <p className="feed-eyebrow">THIS ONE LIVING COMMUNITY</p>
          <h1>Home</h1>
          <p className="muted">Share useful ideas, learn from one another, and grow together.</p>
        </div>
        <Link className="btn btn-secondary" to="/discover">Find people</Link>
      </header>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {notice && <p className="feed-notice" role="status">{notice}</p>}

      <form className="feed-composer card" onSubmit={createPost}>
        <label htmlFor="feed-post-draft">Create a post</label>
        <textarea
          id="feed-post-draft"
          value={postDraft}
          onChange={(event) => setPostDraft(event.target.value)}
          placeholder="Share something useful with the community…"
          maxLength={5000}
          required
        />
        <div className="feed-composer-footer">
          <span className="muted">{postDraft.length}/5000</span>
          <button className="btn btn-primary" type="submit" disabled={postBusy || !postDraft.trim()}>
            <Send size={16} aria-hidden="true" />
            {postBusy ? 'Publishing…' : 'Publish post'}
          </button>
        </div>
      </form>

      <div className="feed-list" aria-live="polite">
        {posts.length === 0 && (
          <div className="card feed-empty">
            <h2>Start the conversation</h2>
            <p className="muted">There are no posts yet. Share the first useful thought with the community.</p>
          </div>
        )}
        {posts.map((post) => (
          <article className="feed-post card" key={post.id}>
            <header className="feed-post-header">
              <div className="feed-author-avatar">
                {post.author_avatar
                  ? <img src={post.author_avatar} alt="" />
                  : <span aria-hidden="true">{initials(post.author_name)}</span>}
              </div>
              <div className="feed-author">
                <strong>{post.author_name}</strong>
                <time dateTime={post.created_at}>{formatDate(post.created_at)}</time>
              </div>
              {post.author_id === userId && (
                <button
                  className="feed-icon-button"
                  type="button"
                  aria-label="Delete your post"
                  disabled={busyAction === `delete:${post.id}`}
                  onClick={() => void deletePost(post.id)}
                >
                  <Trash2 size={18} aria-hidden="true" />
                </button>
              )}
            </header>
            <p className="feed-post-body">{post.body}</p>
            <div className="feed-post-actions">
              <button
                className={`feed-action${post.liked_by_me ? ' is-liked' : ''}`}
                type="button"
                aria-pressed={post.liked_by_me}
                disabled={busyAction === `like:${post.id}`}
                onClick={() => void toggleLike(post)}
              >
                <Heart size={17} aria-hidden="true" />
                <span>{post.like_count} {post.like_count === 1 ? 'Like' : 'Likes'}</span>
              </button>
              <button
                className="feed-action"
                type="button"
                disabled={busyAction === `comments:${post.id}`}
                onClick={() => void toggleComments(post.id)}
              >
                <MessageCircle size={17} aria-hidden="true" />
                <span>{post.comment_count} {post.comment_count === 1 ? 'Comment' : 'Comments'}</span>
              </button>
              <button
                className="feed-action"
                type="button"
                disabled={busyAction === `share:${post.id}`}
                onClick={() => void sharePost(post)}
              >
                <Share2 size={17} aria-hidden="true" />
                <span>{post.share_count} {post.share_count === 1 ? 'Share' : 'Shares'}</span>
              </button>
            </div>

            {openComments.includes(post.id) && (
              <section className="feed-comments" aria-label={`Comments on ${post.author_name}'s post`}>
                {(comments[post.id] ?? []).map((comment) => (
                  <article className="feed-comment" key={comment.id}>
                    <div className="feed-comment-avatar">
                      {comment.author_avatar
                        ? <img src={comment.author_avatar} alt="" />
                        : <span aria-hidden="true">{initials(comment.author_name)}</span>}
                    </div>
                    <div className="feed-comment-content">
                      <strong>{comment.author_name}</strong>
                      <p>{comment.body}</p>
                      <time dateTime={comment.created_at}>{formatDate(comment.created_at)}</time>
                    </div>
                  </article>
                ))}
                {(comments[post.id] ?? []).length === 0 && (
                  <p className="muted feed-no-comments">No comments yet.</p>
                )}
                <form className="feed-comment-form" onSubmit={(event) => void createComment(event, post.id)}>
                  <label className="visually-hidden" htmlFor={`comment-${post.id}`}>Write a comment</label>
                  <input
                    id={`comment-${post.id}`}
                    value={commentDrafts[post.id] ?? ''}
                    onChange={(event) => setCommentDrafts((current) => ({ ...current, [post.id]: event.target.value }))}
                    placeholder="Write a constructive comment…"
                    maxLength={2000}
                    required
                  />
                  <button
                    className="btn btn-primary btn-sm"
                    type="submit"
                    disabled={busyAction === `comment:${post.id}` || !(commentDrafts[post.id] ?? '').trim()}
                  >
                    Comment
                  </button>
                </form>
              </section>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
