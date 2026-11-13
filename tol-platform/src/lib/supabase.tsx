import { createClient } from '@supabase/supabase-js';

// Only the public anon key belongs here. Never use the service-role key in frontend code.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string
);
