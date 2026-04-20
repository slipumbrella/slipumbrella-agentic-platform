'use client'
import { useEffect, useState } from 'react'
import { Provider } from 'react-redux'
import { fetchProfile } from '../lib/features/auth/authSlice'
import { AppStore, makeStore } from '../lib/store'

export default function StoreProvider({
  children
}: {
  children: React.ReactNode
}) {
  const [store] = useState<AppStore>(() => makeStore())

  useEffect(() => {
    // Only fetch profile when a session cookie exists to avoid
    // kicking off an auth loop when the user is unauthenticated.
    const hasSession =
      typeof document !== 'undefined' &&
      document.cookie.includes('session_exists=');

    if (hasSession) {
      const state = store.getState();
      if (!state.auth.user) {
        store.dispatch(fetchProfile());
      }
    }
  }, [store]);

  return <Provider store={store}>{children}</Provider>
}