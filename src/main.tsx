import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/instrument-serif/400.css';
import '@fontsource/instrument-serif/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import './lib/theme';
import './styles/app.css';
import { AdminPage } from './components/AdminPage';
import { AlbumPage } from './components/AlbumPage';
import { BoardPage } from './components/BoardPage';
import { Landing } from './components/Landing';
import { Toasts } from './components/ui/toast';
import { parseRoute, useRoute } from './router';

function App() {
  const path = useRoute((s) => s.path);
  const route = parseRoute(path);
  return (
    <>
      {route.name === 'board' ? (
        <BoardPage key={route.token} token={route.token} />
      ) : route.name === 'album' ? (
        <AlbumPage key={route.token} token={route.token} song={route.song} />
      ) : route.name === 'admin' ? (
        <AdminPage />
      ) : (
        <Landing />
      )}
      <Toasts />
    </>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
