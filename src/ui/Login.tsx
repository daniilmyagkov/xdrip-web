/** First run: connect by QR from the master phone, by its link, or by typing the Nightscout address and access key. */
import { useCallback, useState } from 'preact/hooks';
import { normaliseBaseUrl, ns, NsError, type Connection } from '../ns/client';
import { parseConnectLink } from '../state/session';
import { QrScanner } from './QrScanner';

export function Login({ onConnected }: { onConnected: (c: Connection) => void }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [manual, setManual] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connect = useCallback(
    async (c: Connection) => {
      setBusy(true);
      setError(null);
      try {
        await ns.status(c);
        const v = await ns.verify(c);
        if (!v.canRead) throw new NsError('Ключ доступа не подходит', 401);
        onConnected(c);
      } catch (e) {
        setError(e instanceof NsError ? e.message : 'Не удалось подключиться');
      } finally {
        setBusy(false);
      }
    },
    [onConnected],
  );

  const onScanned = useCallback(
    (c: Connection) => {
      setScanning(false);
      void connect(c);
    },
    [connect],
  );

  const onLink = (text: string) => {
    const c = parseConnectLink(text);
    if (c) void connect(c);
    else if (text.trim()) setError('Это не ссылка из «Веб-доступа». Скопируйте её на мастере ещё раз.');
  };

  return (
    <div class="screen" style={{ paddingBottom: '40px' }}>
      <div style={{ textAlign: 'center', margin: '28px 0 22px' }}>
        <img src="./icon-192.png" width={72} height={72} alt="" style={{ borderRadius: '18px' }} />
        <div class="screen-title" style={{ margin: '12px 0 4px' }}>
          xDrip Redesign
        </div>
        <div class="muted">Сахар, приёмы пищи и УК — с любого устройства</div>
      </div>

      <div class="card">
        <div style={{ fontWeight: 800 }}>Подключение</div>
        <div class="lo small" style={{ marginTop: '6px' }}>
          На телефоне-мастере в xDrip откройте <b>Ещё → Веб-доступ</b> и отсканируйте QR-код.
        </div>
        <button class="btn btn-primary btn-block" style={{ marginTop: '14px' }} disabled={busy} onClick={() => setScanning(true)}>
          {busy ? 'Подключаюсь…' : 'Сканировать QR-код'}
        </button>
        <label class="field">
          <span>или вставьте ссылку, присланную с мастера</span>
          <input
            class="input"
            autoCapitalize="off"
            autoCorrect="off"
            spellcheck={false}
            placeholder="https://…#connect=…"
            onPaste={(e) => {
              const text = e.clipboardData?.getData('text') ?? '';
              if (text) {
                e.preventDefault();
                e.currentTarget.value = text;
                onLink(text);
              }
            }}
            onChange={(e) => onLink(e.currentTarget.value)}
          />
        </label>
      </div>

      {error && (
        <div class="banner error" style={{ marginTop: '12px' }}>
          {error}
        </div>
      )}

      {!manual ? (
        <button class="btn btn-ghost btn-block" style={{ marginTop: '12px' }} onClick={() => setManual(true)}>
          Ввести адрес Nightscout вручную
        </button>
      ) : (
        <div class="card" style={{ marginTop: '12px' }}>
          <div style={{ fontWeight: 800 }}>Вручную</div>
          <label class="field">
            <span>Адрес Nightscout</span>
            <input class="input" autoCapitalize="off" autoCorrect="off" spellcheck={false} placeholder="https://…" value={url} onInput={(e) => setUrl(e.currentTarget.value)} />
          </label>
          <label class="field">
            <span>Ключ доступа (токен), если есть</span>
            <input class="input" autoCapitalize="off" autoCorrect="off" spellcheck={false} placeholder="xdripweb-…" value={token} onInput={(e) => setToken(e.currentTarget.value)} />
          </label>
          <div class="caption" style={{ marginTop: '6px' }}>
            Без ключа сайт работает только на просмотр (если ваш Nightscout это разрешает).
          </div>
          <button
            class="btn btn-primary btn-block"
            style={{ marginTop: '14px' }}
            disabled={busy || !url.trim()}
            onClick={() => void connect({ baseUrl: normaliseBaseUrl(url), token: token.trim() })}
          >
            {busy ? 'Подключаюсь…' : 'Подключиться'}
          </button>
        </div>
      )}
      <div class="caption" style={{ textAlign: 'center', marginTop: '14px' }}>
        Адрес и ключ хранятся только на этом устройстве.
      </div>
      {scanning && <QrScanner onResult={onScanned} onClose={() => setScanning(false)} />}
    </div>
  );
}
