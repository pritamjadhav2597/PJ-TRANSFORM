/**
 * supabase-config.js
 * ---------------------------------------------------------------------------
 * Fill these in from your Supabase project: Dashboard → Project Settings →
 * API. "Project URL" and the "anon public" / "Publishable" key (NOT the
 * secret/service_role key — that one must never appear in frontend code).
 * ---------------------------------------------------------------------------
 */
const SUPABASE_URL = 'https://ulsechsneyubrglpoqvz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yIq6QnYYow8o9Us0h4a8Yg_W8wfDiIK';

const supabaseClient = (SUPABASE_URL.startsWith('http'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
