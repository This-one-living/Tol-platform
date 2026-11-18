import { supabase } from './supabase'

const decodeVapidKey = (value: string) => {
  const padded = value + '='.repeat((4 - value.length % 4) % 4)
  const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  return Uint8Array.from(raw, (character) => character.charCodeAt(0))
}

export async function getBrowserPushSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null
  const registration = await navigator.serviceWorker.getRegistration('/')
  return registration?.pushManager.getSubscription() ?? null
}

export async function isBrowserPushEnabledForUser(userId: string) {
  if (!supabase) throw new Error('Connect this app to Supabase before managing notifications.')
  const subscription = await getBrowserPushSubscription()
  if (!subscription) return false

  const { data, error } = await supabase
    .from('push_subscriptions')
    .select('endpoint')
    .eq('user_id', userId)
    .eq('endpoint', subscription.endpoint)
    .maybeSingle()
  if (error) throw new Error(`Could not check this browser's push settings: ${error.message}`)
  return Boolean(data)
}

export async function enableBrowserPush() {
  if (!supabase) throw new Error('Connect this app to Supabase before enabling notifications.')
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('This browser does not support push notifications.')
  }

  const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY
  if (!vapidPublicKey) {
    throw new Error('Browser push is not configured yet. Add VITE_VAPID_PUBLIC_KEY and try again.')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Allow browser notifications to enable push alerts.')

  const registration = await navigator.serviceWorker.register('/sw.js')
  const existingSubscription = await registration.pushManager.getSubscription()
  const subscription = existingSubscription ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeVapidKey(vapidPublicKey),
  })
  const keys = subscription.toJSON().keys
  if (!keys?.p256dh || !keys.auth) {
    if (!existingSubscription) await subscription.unsubscribe()
    throw new Error('The browser returned an incomplete push subscription.')
  }

  const { error } = await supabase.rpc('save_push_subscription', {
    target_endpoint: subscription.endpoint,
    target_p256dh: keys.p256dh,
    target_auth: keys.auth,
    target_expiration_time: subscription.expirationTime
      ? new Date(subscription.expirationTime).toISOString()
      : null,
  })
  if (error) {
    if (!existingSubscription) await subscription.unsubscribe()
    throw new Error(`Could not save this browser's push subscription: ${error.message}`)
  }

  return subscription
}

export async function disableBrowserPush(userId: string) {
  if (!supabase) throw new Error('Connect this app to Supabase before managing notifications.')
  const subscription = await getBrowserPushSubscription()
  if (!subscription) return

  const { error } = await supabase
    .from('push_subscriptions')
    .delete()
    .eq('user_id', userId)
    .eq('endpoint', subscription.endpoint)
  if (error) throw new Error(`Could not remove this browser's push subscription: ${error.message}`)

  await subscription.unsubscribe()
}
