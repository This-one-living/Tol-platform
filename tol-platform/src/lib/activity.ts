import { supabase } from './supabase'

export type AccountActivityType =
  | 'account_created'
  | 'signed_in'
  | 'signed_out'
  | 'password_changed'
  | 'password_reset'
  | 'profile_updated'
  | 'profile_photo_updated'
  | 'joined_group'
  | 'left_group'

export async function recordAccountActivity(
  activityType: AccountActivityType,
  groupId?: string,
): Promise<string | null> {
  if (!supabase) return null

  try {
    const { error } = await supabase.rpc('log_account_activity', {
      activity_type: activityType,
      target_group_id: groupId ?? null,
    })
    return error?.message ?? null
  } catch (error) {
    return error instanceof Error ? error.message : 'Could not record account activity.'
  }
}
