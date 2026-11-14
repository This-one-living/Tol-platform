import { createClient } from '@supabase/supabase-js';

const normalizeSupabaseUrl = (value: string | undefined) => {
  if (!value) return '';
  return value.trim().replace(/\/(rest|auth|storage|functions)\/v1\/?$/, '');
};

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL);
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? '';

// Only the public anon key belongs here. Never use the service-role key in frontend code.
export const supabase = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;
