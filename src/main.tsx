import { render } from 'preact';
import './styles/app.css';
import { App } from './ui/App';

render(<App />, document.getElementById('app')!);

// Offline shell + "install as app". Only in the built site: the dev server must never be cached.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* the site works without it */
    });
  });
}
