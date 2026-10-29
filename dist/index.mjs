import { definePlugin } from "emdash";
// src/index.ts
const PLUGIN_ID = "resend-email";
const VERSION = "0.1.0";
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
		const replyTo = message.replyTo ?? (isValidEmail(configuredReplyTo) ? configuredReplyTo : void 0);
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
				...message.html ? { html: message.html } : {}
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
			}
		} },
		hooks: { "email:deliver": {
			exclusive: true,
			handler: createResendDeliver()
		} }
	});
}
export { createPlugin, createResendDeliver, resendEmail as default, resendEmail, formatSender, isValidEmail };
