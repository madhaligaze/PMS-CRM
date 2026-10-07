import '@fontsource-variable/onest';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/shell.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { isApiError } from './api/errors';
import { startEvents } from './api/events';
import { makeRouter } from './app/router';
import { boot, useSession } from './auth/session';
import { Toasts } from './components/ui/toast';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // 4xx не повторяем: права и проверки от повтора не изменятся.
      retry: (count, err) => !(isApiError(err) && err.status < 500) && count < 2,
    },
    mutations: { retry: false },
  },
});

const router = makeRouter(queryClient);

function App() {
  const session = useSession();

  // Сессия закончилась (выход, отзыв, истечение) - на вход; вошли - на главную.
  // Пароль выдан управляющим - сначала свой пароль, экран входа держит это сам.
  const mustChange = session.me?.mustChangePassword ?? false;
  useEffect(() => {
    if (session.status === 'booting') return;
    const path = router.state.location.pathname;
    if (session.status === 'anonymous' && path !== '/login' && path !== '/kiosk') {
      queryClient.clear();
      void router.navigate({ to: '/login' });
    }
    if (session.status === 'authenticated' && mustChange && path !== '/login') void router.navigate({ to: '/login' });
    if (session.status === 'authenticated' && !mustChange && path === '/login') void router.navigate({ to: '/' });
  }, [session.status, mustChange]);

  useEffect(() => {
    if (session.status !== 'authenticated') return;
    return startEvents(queryClient);
  }, [session.status, session.propertyId]);

  if (session.status === 'booting') return <div className="boot" aria-busy="true" />;
  return (
    <>
      <RouterProvider router={router} />
      <Toasts />
    </>
  );
}

void boot();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
