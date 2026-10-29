import { definePlugin } from "emdash";
// src/template.ts
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const URL_LINE = /^https?:\/\/\S+$/i;
function isHexColor(value) {
	return typeof value === "string" && HEX_COLOR.test(value);
}
function escapeHtml(value) {
	return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
/** Black or white, whichever reads better on the given #rrggbb background. */
function readableOn(hex) {
	const [r, g, b] = [
		1,
		3,
		5
	].map((i) => parseInt(hex.slice(i, i + 2), 16));
	return (r * 299 + g * 587 + b * 114) / 1e3 > 150 ? "#0b1220" : "#ffffff";
}
/**
* Button labels from the HTML the sender supplied, keyed by URL. Core emails
* carry their button text only in the HTML (`<a href="…">Sign in</a>`).
*/
function extractLinkLabels(html) {
	const labels = /* @__PURE__ */ new Map();
	if (!html) return labels;
	for (const [, href, label] of html.matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([^<]{1,80})<\/a>/gi)) {
		const url = href.replace(/&amp;/g, "&");
		const text = label.replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim();
		if (text && !labels.has(url)) labels.set(url, text);
	}
	return labels;
}
/** Split plain text into paragraphs and standalone-URL lines. */
function parseBlocks(text) {
	const blocks = [];
	let current = [];
	const flush = () => {
		if (current.length) blocks.push({
			kind: "text",
			lines: current
		});
		current = [];
	};
	for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
		const line = raw.trim();
		if (!line) flush();
		else if (URL_LINE.test(line)) {
			flush();
			blocks.push({
				kind: "link",
				url: line
			});
		} else current.push(line);
	}
	flush();
	return blocks;
}
/** Wrap an email's plain-text body in a branded, client-safe HTML layout. */
function renderBrandedEmail(message, brand) {
	const color = isHexColor(brand.color) ? brand.color : "#111827";
	const accent = isHexColor(brand.accent) ? brand.accent : color;
	const onColor = readableOn(color);
	const name = escapeHtml(brand.name);
	const labels = extractLinkLabels(message.html);
	const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
	const serif = "'Instrument Serif',Georgia,'Times New Roman',serif";
	const body = parseBlocks(message.text).map((block) => {
		if (block.kind === "text") return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f2937;" class="ink">${block.lines.map(escapeHtml).join("<br>")}</p>`;
		const href = escapeHtml(block.url);
		const label = escapeHtml(labels.get(block.url) ?? "Open link");
		return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr><td style="border-radius:8px;background:${color};" class="btn"><a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:16px;font-weight:600;color:${onColor};text-decoration:none;border-radius:8px;" class="btn-link">${label}</a></td></tr></table>
<p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#6b7280;word-break:break-all;" class="muted">Button not working? Copy this link into your browser:<br>${href}</p>`;
	}).join("\n");
	return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(message.subject)}</title>
<style>
@media (prefers-color-scheme: dark) {
  .page { background:#0b1220 !important; }
  .card { background:#111a2e !important; }
  .ink, .title { color:#f1f4fa !important; }
  .muted { color:#9aa6bd !important; }
}
</style>
</head>
<body style="margin:0;padding:0;background:#f4f5f8;" class="page">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f8;" class="page">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:100%;max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;" class="card">
<tr><td style="background:${color};padding:26px 32px;font-family:${serif};font-size:28px;line-height:1.1;color:${onColor};">${name}</td></tr>
<tr><td style="background:${accent};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>
<tr><td style="padding:36px 32px 12px;font-family:${font};">
<h1 style="margin:0 0 20px;font-size:24px;line-height:1.25;font-weight:600;color:#0b1220;" class="title">${escapeHtml(message.subject)}</h1>
${body}
</td></tr>
<tr><td style="padding:8px 32px 32px;font-family:${font};font-size:13px;line-height:1.5;color:#6b7280;" class="muted">Sent by ${name}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
// src/index.ts
const PLUGIN_ID = "resend-email";
const VERSION = "0.2.0";
const ENTRYPOINT = "emdash-resend";
const RESEND_API_URL = "https://api.resend.com/emails";
const CAPABILITIES = ["hooks.email-transport:register", "network:request"];
const ALLOWED_HOSTS = ["api.resend.com"];
const EMAIL_PATTERN = /^[^\s<>",;\\]+@[^\s<>",;\\@]+\.[^\s<>",;\\@]+$/;
function isValidEmail(value) {
	return typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value);
}
/** Build the `Name <address>` form Resend expects, dropping characters that could break the header. */
function formatSender(email, name) {
	const cleanName = (name ?? "").replace(/[\r\n]+/g, " ").replace(/[<>"\\]/g, "").trim();
	return cleanName ? `${cleanName} <${email}>` : email;
}
/** Build the email:deliver handler. Exported for tests. */
function createResendDeliver() {
	return async (event, ctx) => {
		const { message } = event;
		if (!ctx.http) throw new Error(`[${PLUGIN_ID}] network access is unavailable. The plugin needs the "network:request" capability.`);
		const apiKey = await ctx.settings.get("apiKey");
		if (!apiKey) throw new Error(`[${PLUGIN_ID}] Resend API key is not set. Add it under Plugins → Resend Email → settings.`);
		const fromEmail = await ctx.settings.get("fromEmail");
		if (!isValidEmail(fromEmail)) throw new Error(`[${PLUGIN_ID}] "From email" is missing or invalid. Set an address on a domain verified in Resend.`);
		const fromName = await ctx.settings.get("fromName");
		const configuredReplyTo = await ctx.settings.get("replyTo");
		const brandName = await ctx.settings.get("brandName");
		const brandColor = await ctx.settings.get("brandColor");
		const accentColor = await ctx.settings.get("accentColor");
		const replyTo = message.replyTo ?? (isValidEmail(configuredReplyTo) ? configuredReplyTo : void 0);
		const html = renderBrandedEmail(message, {
			name: brandName?.trim() || fromName?.trim() || fromEmail.split("@")[1],
			color: isHexColor(brandColor) ? brandColor : null,
			accent: isHexColor(accentColor) ? accentColor : null
		});
		const response = await ctx.http.fetch(RESEND_API_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json"
			},
			body: JSON.stringify({
				from: formatSender(fromEmail, fromName),
				to: [message.to],
				...message.cc?.length ? { cc: message.cc } : {},
				...replyTo ? { reply_to: replyTo } : {},
				subject: message.subject,
				text: message.text,
				html
			})
		});
		if (!response.ok) {
			const detail = (await response.text()).slice(0, 300);
			throw new Error(`[${PLUGIN_ID}] Resend rejected the message (HTTP ${response.status}): ${detail}`);
		}
		const result = await response.json().catch(() => ({}));
		ctx.log.info("Email delivered via Resend", {
			source: event.source,
			messageId: result.id
		});
	};
}
/** Descriptor for `astro.config.mjs`. All configuration is entered in the admin. */
function resendEmail() {
	return {
		id: PLUGIN_ID,
		version: VERSION,
		format: "native",
		entrypoint: ENTRYPOINT,
		capabilities: [...CAPABILITIES],
		allowedHosts: ALLOWED_HOSTS
	};
}
function createPlugin() {
	return definePlugin({
		id: PLUGIN_ID,
		version: VERSION,
		capabilities: [...CAPABILITIES],
		allowedHosts: ALLOWED_HOSTS,
		admin: { settingsSchema: {
			apiKey: {
				type: "secret",
				label: "Resend API key",
				description: "Create a sending-access key at resend.com/api-keys. Stored encrypted."
			},
			fromEmail: {
				type: "email",
				label: "From email",
				description: "Must be on a domain verified in Resend, e.g. cms@mail.example.com.",
				placeholder: "cms@mail.example.com"
			},
			fromName: {
				type: "string",
				label: "From name",
				description: "Optional display name shown to recipients."
			},
			replyTo: {
				type: "email",
				label: "Reply-to email",
				description: "Optional. Replies go here instead of the From address."
			},
			brandName: {
				type: "string",
				label: "Email wordmark",
				description: "Optional. Name shown in the email header. Defaults to the From name."
			},
			brandColor: {
				type: "string",
				label: "Email brand colour",
				description: "Optional. Header and button colour as #rrggbb, e.g. #13274a. Defaults to near-black."
			},
			accentColor: {
				type: "string",
				label: "Email accent colour",
				description: "Optional. Thin rule under the header as #rrggbb, e.g. #d4a62a. Defaults to the brand colour."
			}
		} },
		hooks: { "email:deliver": {
			exclusive: true,
			handler: createResendDeliver()
		} }
	});
}
export { createPlugin, createResendDeliver, resendEmail as default, resendEmail, formatSender, isValidEmail };
