/** App shell: connection, data, bottom navigation (Главная · Приёмы · Доза · Ещё), entry sheet, toast. */
import type { JSX } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { effective, type UkSettings } from '../core/settings';
import type { Connection } from '../ns/client';
import { clearConnection, connectionFromLocation, loadConnection, saveConnection } from '../state/session';
import { loadSettings, saveSettings } from '../state/settings';
import { useStore } from '../state/store';
import { Dose } from './Dose';
import { EntrySheet } from './EntrySheet';
import { Home } from './Home';
import { Login } from './Login';
import { Meals } from './Meals';
import { More } from './More';

type Tab = 'home' | 'meals' | 'dose' | 'more';

const ICONS: Record<Tab, JSX.Element> = {
  home: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 17l5-6 4 3 5-7 4 4" />
      <path d="M3 21h18" />
    </svg>
  ),
  meals: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 3v8a2 2 0 0 0 2 2v8M5 3v5M9 3v5" />
      <path d="M17 21V3c-2.2 1.2-3 4-3 7v4h3" />
    </svg>
  ),
  dose: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="5" y="3" width="14" height="18" rx="2.5" />
      <path d="M9 8h6M9 12h2M13 12h2M9 16h2M13 16h2" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 24 24" fill="currentColor">
      <circle cx="5" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="19" cy="12" r="2" />
    </svg>
  ),
};

const TABS: Array<[Tab, string]> = [
  ['home', 'Главная'],
  ['meals', 'Приёмы'],
  ['dose', 'Доза'],
  ['more', 'Ещё'],
];

function initialConnection(): Connection | null {
  const fromLink = connectionFromLocation();
  if (fromLink) {
    saveConnection(fromLink);
    return fromLink;
  }
  return loadConnection();
}

export function App() {
  const [conn, setConn] = useState<Connection | null>(initialConnection);
  const [settings, setSettings] = useState<UkSettings>(loadSettings);
  const [tab, setTab] = useState<Tab>('home');
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const store = useStore(conn);
  const eff = useMemo(() => effective(settings), [settings]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    // a link from the master opened in a tab where the site is already running
    const onHash = () => {
      const c = connectionFromLocation();
      if (c) {
        saveConnection(c);
        setConn(c);
        setTab('home');
      }
    };
    window.addEventListener('hashchange', onHash);
    return () => {
      clearInterval(id);
      window.removeEventListener('hashchange', onHash);
    };
  }, []);
  useEffect(() => setNow(Date.now()), [store.data]);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  if (!conn) {
    return (
      <Login
        onConnected={(c) => {
          saveConnection(c);
          setConn(c);
        }}
      />
    );
  }

  const signOut = () => {
    clearConnection();
    setConn(null);
    setTab('home');
  };
  const updateSettings = (s: UkSettings) => {
    saveSettings(s);
    setSettings(s);
  };
  // a change or deletion was sent: say so, and reload — the waiting request already shows the result
  const onChanged = (message: string) => {
    setToast(message);
    void store.refresh();
  };

  const data = store.data;
  let body: JSX.Element;
  if (tab === 'more') {
    body = <More conn={conn} settings={settings} onSettings={updateSettings} onSignOut={signOut} />;
  } else if (!data) {
    body = (
      <div class="screen">
        <div class="empty">{store.error ? null : <span class="spinner" />}</div>
      </div>
    );
  } else if (tab === 'home') {
    body = <Home data={data} settings={eff} now={now} conn={conn} onAdd={() => setAdding(true)} onChanged={onChanged} />;
  } else if (tab === 'meals') {
    body = <Meals data={data} settings={eff} now={now} conn={conn} onChanged={onChanged} />;
  } else {
    body = <Dose data={data} settings={eff} now={now} />;
  }

  return (
    <>
      {store.error && (
        <div class="screen" style={{ paddingBottom: 0 }}>
          <div class="banner error row">
            <span style={{ flex: 1 }}>
              {store.error}
              {data ? ` · данные от ${new Date(data.loadedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : ''}
            </span>
            <button class="btn btn-ghost" style={{ padding: '6px 12px' }} onClick={() => void store.refresh()}>
              Повторить
            </button>
          </div>
        </div>
      )}
      {body}
      {adding && data && (
        <EntrySheet
          conn={conn}
          entries={data.entries}
          settings={eff}
          onClose={() => setAdding(false)}
          onSaved={(msg) => {
            setToast(msg);
            void store.refresh();
          }}
        />
      )}
      {toast && <div class="toast">{toast}</div>}
      <nav class="nav">
        <div class="nav-inner">
          {TABS.map(([t, label]) => (
            <button key={t} class={tab === t ? 'on' : ''} onClick={() => setTab(t)} aria-current={tab === t ? 'page' : undefined}>
              {ICONS[t]}
              {label}
            </button>
          ))}
        </div>
      </nav>
    </>
  );
}
