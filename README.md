# emdash-resend

Send EmDash email (magic links, invites, account recovery, plugin mail) through [Resend](https://resend.com). Everything is configured from the EmDash admin; nothing secret goes in your repo or config files.

Requires EmDash `>=1.3.0`. Works on Cloudflare Workers (including the free plan) and Node, because it only makes an HTTPS call to `api.resend.com`.

## Install

```bash
npm install github:creimer808/emdash-resend#v0.1.0
```

Register it in `astro.config.mjs`:

```js
import { resendEmail } from "emdash-resend";

emdash({
  // ...your database/storage config
  plugins: [resendEmail()],
});
```

`dist/` is committed so the package installs straight from GitHub with no build step.

## Set up

1. In Resend, verify your sending domain (SPF/DKIM) and create an API key.
2. Set an encryption key for plugin secrets, once per site. On Cloudflare:
   ```bash
   npx emdash secrets generate
   npx wrangler secret put EMDASH_ENCRYPTION_KEY
   ```
   Keep a separate backup of that value. A database backup cannot decrypt the saved API key without it.
3. Deploy, then in the admin open **Plugins → Resend Email → settings** and enter:
   - **Resend API key** (stored encrypted, never shown again)
   - **From email** (on your verified domain)
   - **From name** and **Reply-to email** (optional)
   - **Email wordmark**, **brand colour** and **accent colour** (optional, colours as `#rrggbb`)
4. Select this plugin under **Settings → Email** and press **Send test email**.

## Branded layout

Every message is sent with a branded HTML layout built from its plain-text body: a coloured header with your wordmark, the subject as the heading, paragraphs, and any link on its own line as a button (labelled from the sender's own HTML when it has one). The plain-text part is sent unchanged. Colours that are not `#rrggbb` are ignored. Without settings you get a near-black header and the From name as the wordmark.

## Trust model

This is a *native* plugin, so it runs in your site's process with the site's authority. Read the ~100 lines in `src/index.ts` before installing.

- Capabilities: `hooks.email-transport:register` (it is the exclusive `email:deliver` provider) and `network:request`.
- Allowed host: `api.resend.com` only. Requests go through EmDash's `ctx.http.fetch`.
- The API key is read at send time from the plugin's encrypted settings and sent only in the `Authorization` header. It is not logged. Resend error bodies (truncated) appear in the failure message; the key does not.
- The display name is stripped of characters that could alter the `From` header, and From/Reply-to must be single valid addresses.

## Development

```bash
npm install
npm run typecheck && npm test && npm run build
```

Commit the rebuilt `dist/` with any source change.

## License

MIT
