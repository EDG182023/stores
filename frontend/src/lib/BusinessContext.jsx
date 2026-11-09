import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase.js';

const Ctx = createContext(null);

export function BusinessProvider({ session, children }) {
  const [business, setBusiness] = useState(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const { data, error } = await supabase
      .from('businesses').select('*')
      .eq('owner_id', session.user.id)
      .order('created_at').limit(1).maybeSingle();
    if (error) console.error(error);
    setBusiness(data || null);
    setLoading(false);
  }, [session.user.id]);

  useEffect(() => { reload(); }, [reload]);

  return (
    <Ctx.Provider value={{ session, business, setBusiness, loading, reload }}>
      {children}
    </Ctx.Provider>
  );
}

export const useBusiness = () => useContext(Ctx);
