import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, MessageSquare, PackagePlus, Search, Trash2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import './Marketplace.css'

type Listing = {
  id: string
  seller_id: string
  item_type: 'product' | 'service'
  title: string
  description: string
  price: number | null
  created_at: string
  seller_name: string
  seller_avatar: string | null
  seller_lga: string
}

type PageStatus = 'loading' | 'ready' | 'signed-out' | 'unconfigured' | 'error'
type ListingFilter = 'all' | 'product' | 'service'

const formatPrice = (price: number | null) => {
  if (price === null) return 'Contact seller for price'
  if (price === 0) return 'Free'
  return `₦${new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 }).format(Number(price))}`
}

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString('en-NG', { dateStyle: 'medium' })

export default function Marketplace() {
  const [status, setStatus] = useState<PageStatus>(supabase ? 'loading' : 'unconfigured')
  const [userId, setUserId] = useState('')
  const [listings, setListings] = useState<Listing[]>([])
  const [searchText, setSearchText] = useState('')
  const [activeSearch, setActiveSearch] = useState('')
  const [filter, setFilter] = useState<ListingFilter>('all')
  const [itemType, setItemType] = useState<'product' | 'service'>('product')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [price, setPrice] = useState('')
  const [loadingListings, setLoadingListings] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadListings = useCallback(async (query: string, listingFilter: ListingFilter) => {
    if (!supabase) return
    setLoadingListings(true)
    const { data, error: loadError } = await supabase.rpc('list_marketplace_listings', {
      p_query: query.trim() || null,
      p_item_type: listingFilter === 'all' ? null : listingFilter,
      p_limit: 60,
      p_offset: 0,
    })
    if (loadError) {
      setError(loadError.message)
      setStatus('error')
    } else {
      setListings((data ?? []) as Listing[])
      setStatus('ready')
    }
    setLoadingListings(false)
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
        return
      }
      if (!data.user) {
        setStatus('signed-out')
        return
      }
      setUserId(data.user.id)
      await loadListings('', 'all')
    }
    void initialize().catch((loadError: unknown) => {
      if (!active) return
      setError(loadError instanceof Error ? loadError.message : 'Could not load Marketplace.')
      setStatus('error')
    })
    return () => { active = false }
  }, [loadListings])

  const searchListings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setActiveSearch(searchText)
    await loadListings(searchText, filter)
  }

  const changeFilter = async (value: ListingFilter) => {
    setFilter(value)
    setError('')
    await loadListings(activeSearch, value)
  }

  const createListing = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || busy) return
    const numericPrice = price.trim() === '' ? null : Number(price)
    if (numericPrice !== null && (!Number.isFinite(numericPrice) || numericPrice < 0)) {
      setError('Enter a valid non-negative price, or leave the price blank.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const { error: createError } = await supabase.rpc('create_marketplace_listing', {
        p_item_type: itemType,
        p_title: title,
        p_description: description,
        p_price: numericPrice,
      })
      if (createError) {
        setError(createError.message)
        return
      }
      setTitle('')
      setDescription('')
      setPrice('')
      setNotice('Your listing is now available in Marketplace.')
      await loadListings(activeSearch, filter)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Could not publish your listing.')
    } finally {
      setBusy(false)
    }
  }

  const deleteListing = async (listingId: string) => {
    if (!supabase || busy) return
    if (!window.confirm('Remove this listing from Marketplace?')) return
    setBusy(true)
    setError('')
    try {
      const { error: deleteError } = await supabase.rpc('delete_own_marketplace_listing', {
        p_listing: listingId,
      })
      if (deleteError) {
        setError(deleteError.message)
        return
      }
      setListings((current) => current.filter((listing) => listing.id !== listingId))
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Could not remove the listing.')
    } finally {
      setBusy(false)
    }
  }

  if (status === 'loading') return <div className="marketplace-state" role="status">Loading Marketplace…</div>

  if (status === 'unconfigured') {
    return (
      <div className="marketplace-state card">
        <h1>Marketplace is unavailable</h1>
        <p>Connect this app to Supabase and apply the Marketplace migration to view listings.</p>
      </div>
    )
  }

  if (status === 'signed-out') {
    return (
      <div className="marketplace-state card">
        <h1>Sign in to browse Marketplace</h1>
        <p>Discover goods and services from the TOL community.</p>
        <Link className="btn btn-primary" to="/auth">Log in</Link>
      </div>
    )
  }

  if (status === 'error') {
    return <p className="alert alert-error" role="alert">{error || 'Could not load Marketplace.'}</p>
  }

  return (
    <section className="marketplace-page">
      <header className="marketplace-heading">
        <div>
          <p className="marketplace-eyebrow">SUPPORT YOUR COMMUNITY</p>
          <h1>Marketplace</h1>
          <p className="muted">Discover products and services offered by TOL members. Contact sellers directly—payments happen outside the app.</p>
        </div>
      </header>

      {error && <p className="alert alert-error" role="alert">{error}</p>}
      {notice && <p className="marketplace-notice" role="status">{notice}</p>}

      <div className="marketplace-layout">
        <form className="marketplace-form card" onSubmit={createListing}>
          <div className="marketplace-form-title">
            <PackagePlus size={20} aria-hidden="true" />
            <h2>Create a listing</h2>
          </div>
          <label>
            Listing type
            <select value={itemType} onChange={(event) => setItemType(event.target.value as 'product' | 'service')}>
              <option value="product">Product</option>
              <option value="service">Service</option>
            </select>
          </label>
          <label>
            Title
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="What are you offering?"
              maxLength={100}
              required
            />
          </label>
          <label>
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Add helpful details about your product or service."
              maxLength={2000}
              required
            />
          </label>
          <label>
            Price in naira <span className="muted">(optional)</span>
            <input
              type="number"
              min="0"
              step="0.01"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              placeholder="Leave blank if negotiable"
            />
          </label>
          <button className="btn btn-primary" type="submit" disabled={busy || !title.trim() || !description.trim()}>
            {busy ? 'Saving…' : 'Publish listing'}
          </button>
          <p className="marketplace-form-note">No checkout or payments are processed in TOL.</p>
        </form>

        <div className="marketplace-results">
          <form className="marketplace-filters" onSubmit={searchListings}>
            <label className="marketplace-search">
              <Search size={18} aria-hidden="true" />
              <input
                type="search"
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
                placeholder="Search products and services"
                aria-label="Search listings"
              />
            </label>
            <label className="marketplace-filter">
              <span className="visually-hidden">Filter listings</span>
              <select value={filter} onChange={(event) => void changeFilter(event.target.value as ListingFilter)}>
                <option value="all">All listings</option>
                <option value="product">Products</option>
                <option value="service">Services</option>
              </select>
            </label>
            <button className="btn btn-secondary btn-sm" type="submit">Search</button>
          </form>

          <p className="muted marketplace-count" aria-live="polite">
            {loadingListings ? 'Loading listings…' : `${listings.length} ${listings.length === 1 ? 'listing' : 'listings'}`}
          </p>

          {!loadingListings && listings.length === 0 && (
            <div className="marketplace-empty card">
              <h2>No listings found</h2>
              <p className="muted">Try another search or be the first to publish a product or service.</p>
            </div>
          )}

          <div className="marketplace-list">
            {listings.map((listing) => (
              <article className="marketplace-listing card" key={listing.id}>
                <div className="marketplace-listing-top">
                  <span className={`marketplace-type marketplace-type-${listing.item_type}`}>
                    {listing.item_type === 'product' ? 'Product' : 'Service'}
                  </span>
                  {listing.seller_id === userId && (
                    <button
                      className="marketplace-delete"
                      type="button"
                      aria-label={`Remove ${listing.title}`}
                      disabled={busy}
                      onClick={() => void deleteListing(listing.id)}
                    >
                      <Trash2 size={17} aria-hidden="true" />
                      Remove
                    </button>
                  )}
                </div>
                <h2>{listing.title}</h2>
                <p className="marketplace-price">{formatPrice(listing.price)}</p>
                <p className="marketplace-description">{listing.description}</p>
                <footer className="marketplace-seller">
                  <span className="marketplace-seller-info">
                    <strong>{listing.seller_name}</strong>
                    <span><MapPin size={14} aria-hidden="true" />{listing.seller_lga}</span>
                    <small>Listed {formatDate(listing.created_at)}</small>
                  </span>
                  {listing.seller_id !== userId && (
                    <Link className="btn btn-secondary btn-sm" to={`/messages?with=${encodeURIComponent(listing.seller_id)}`}>
                      <MessageSquare size={15} aria-hidden="true" />
                      Contact seller
                    </Link>
                  )}
                </footer>
              </article>
            ))}
          </div>
        </div>
      </div>
    </section>
  )
}
