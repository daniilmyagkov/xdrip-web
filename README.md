# xDrip Redesign — web

The xDrip Redesign follower as a website / installable app (PWA), for any phone, tablet or
computer, iPhone included: current glucose and graph, meals with their carb ratio (УК),
the "dose before eating" helper, and adding food / insulin / notes.

There is no server of its own. Every user's browser talks directly to **their own Nightscout**:

- The master phone (xDrip Redesign on Android, «Ещё → Веб-доступ») creates a dedicated
  Nightscout access token with only the `readable` + `careportal` roles and shows a QR code
  `…/#connect=<base64url({u, t})>`. The part after `#` never reaches the web server.
- Address and token are kept in the browser's local storage on that device only.
- Entries made on the site are written to Nightscout; the master downloads them and syncs
  them to the Android followers like any other entry.

The carb-ratio engine in `src/core` is a line-by-line port of the Android `carbratio` package
and is checked against it with the same test vectors (`tests/parity.test.ts`).

## Development

```bash
npm install
npm run dev        # local server
npm test           # unit tests (Europe/Moscow time zone)
npm run build      # type check + production build into dist/
```

Pushing to `main` runs the tests and publishes `dist/` to GitHub Pages
(`.github/workflows/deploy.yml`).

Licensed under the GNU GPL v3, like xDrip. Nunito font: SIL Open Font License.
