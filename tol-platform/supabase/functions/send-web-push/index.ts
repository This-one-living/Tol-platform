import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type, x-push-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405, headers: corsHeaders })
  }

  const expectedSecret = Deno.env.get('PUSH_WEBHOOK_SECRET')
  if (!expectedSecret || request.headers.get('x-push-secret') !== expectedSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const vapidPublicKey = Deno.env.get('VAPID_PUBLIC_KEY')
  const vapidPrivateKey = Deno.env.get('VAPID_PRIVATE_KEY')
  const vapidSubject = Deno.env.get('VAPID_SUBJECT')
  if (!supabaseUrl || !serviceRoleKey || !vapidPublicKey || !vapidPrivateKey || !vapidSubject) {
    return Response.json({ error: 'Push delivery is not configured' }, { status: 500, headers: corsHeaders })
  }

  let notificationId: string
  try {
    const body: unknown = await request.json()
    if (
      typeof body !== 'object'
      || body === null
      || !('notification_id' in body)
      || typeof body.notification_id !== 'string'
    ) {
      return Response.json({ error: 'Invalid notification payload' }, { status: 400, headers: corsHeaders })
    }
    notificationId = body.notification_id
  } catch {
    return Response.json({ error: 'Invalid JSON payload' }, { status: 400, headers: corsHeaders })
  }

  const client = createClient(supabaseUrl, serviceRoleKey)
  const { data: notification, error: notificationError } = await client
    .from('notifications')
    .select('id, user_id, title, body, data, read_at')
    .eq('id', notificationId)
    .maybeSingle()
  if (notificationError) {
    console.error('Could not load notification for push delivery:', notificationError.message)
    return Response.json({ error: 'Could not load notification' }, { status: 500, headers: corsHeaders })
  }
  if (!notification) {
    return Response.json({ error: 'Notification not found' }, { status: 404, headers: corsHeaders })
  }
  if (notification.read_at) {
    return Response.json({ sent: 0, skipped: 'Notification already read' }, { headers: corsHeaders })
  }

  const { data: subscriptions, error: subscriptionsError } = await client
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', notification.user_id)
  if (subscriptionsError) {
    console.error('Could not load push subscriptions:', subscriptionsError.message)
    return Response.json({ error: 'Could not load push subscriptions' }, { status: 500, headers: corsHeaders })
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey)
  const payload = JSON.stringify({
    title: notification.title,
    body: notification.body ?? '',
    data: notification.data ?? {},
  })
  const results = await Promise.allSettled((subscriptions ?? []).map(async (subscription) => {
    try {
      await webpush.sendNotification({
        endpoint: subscription.endpoint,
        keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      }, payload)
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'statusCode' in error
        && (error.statusCode === 404 || error.statusCode === 410)) {
        const { error: deleteError } = await client
          .from('push_subscriptions')
          .delete()
          .eq('id', subscription.id)
        if (deleteError) throw deleteError
        return
      }
      throw error
    }
  }))

  const failed = results.filter((result) => result.status === 'rejected')
  if (failed.length > 0) {
    console.error('Some browser push deliveries failed:', failed.length)
    return Response.json({ sent: results.length - failed.length, failed: failed.length }, {
      status: 502,
      headers: corsHeaders,
    })
  }

  return Response.json({ sent: results.length }, { headers: corsHeaders })
})
