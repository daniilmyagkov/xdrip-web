/** First run: connect by QR from the master phone, or by typing the Nightscout address and access key. */
import { useState } from 'preact/hooks';
import { normaliseBaseUrl, ns, NsError, type Connection } from '../ns/client';

export function Login({ onConnected, initialError }: { onConnected: (c: Connection) => void; initialError?: string | null }) {
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError ?? null);

  async function connect() {
    setBusy(true);
    setError(null);
    const c: Connection = { baseUrl: normaliseBaseUrl(url), token: token.trim() };
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
  }

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
        <div style={{ fontWeight: 800 }}>Быстрое подключение</div>
        <div class="lo small" style={{ marginTop: '6px' }}>
          На телефоне-мастере в xDrip откройте <b>Ещё → Веб-доступ</b> и наведите на QR-код камеру этого устройства. Сайт откроется уже подключённым к вашим данным.
        </div>
      </div>

      <div class="card" style={{ marginTop: '12px' }}>
        <div style={{ fontWeight: 800 }}>Или вручную</div>
        <label class="field">
          <span>Адрес Nightscout</span>
          <input class="input" autoCapitalize="off" autoCorrect="off" spellcheck={false} placeholder="https://…" value={url} onInput={(e) => setUrl(e.currentTarget.value)} />
        </label>
        <label class="field">
          <span>Ключ доступа (токен)</span>
          <input class="input" autoCapitalize="off" autoCorrect="off" spellcheck={false} placeholder="xdripweb-…" value={token} onInput={(e) => setToken(e.currentTarget.value)} />
        </label>
        {error && (
          <div class="banner error" style={{ marginTop: '12px' }}>
            {error}
          </div>
        )}
        <button class="btn btn-primary btn-block" style={{ marginTop: '16px' }} disabled={busy || !url.trim()} onClick={connect}>
          {busy ? 'Подключаюсь…' : 'Подключиться'}
        </button>
      </div>
      <div class="caption" style={{ textAlign: 'center', marginTop: '14px' }}>
        Адрес и ключ хранятся только на этом устройстве.
      </div>
    </div>
  );
}
