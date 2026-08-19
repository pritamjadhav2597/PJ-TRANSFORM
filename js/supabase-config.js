const SUPABASE_URL = 'https://ulsechsneyubrglpoqvz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_yIq6QnYYow8o9Us0h4a8Yg_W8wfDiIK';

const supabaseClient = (SUPABASE_URL.startsWith('http'))
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
