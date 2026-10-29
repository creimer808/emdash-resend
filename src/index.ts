import { definePlugin } from "emdash";
import type { PluginContext, PluginDescriptor } from "emdash";
import type { EmailDeliverEvent } from "emdash/plugin";
import { isHexColor, renderBrandedEmail } from "./template";

const PLUGIN_ID = "resend-email";
const VERSION = "0.2.0";
const ENTRYPOINT = "emdash-resend";
const RESEND_API_URL = "https://api.resend.com/emails";
const CAPABILITIES = ["hooks.email-transport:register", "network:request"] as const;
const ALLOWED_HOSTS = ["api.resend.com"];

// One address, no whitespace, no angle brackets or control characters.
const EMAIL_PATTERN = /^[^\s<>",;\\]+@[^\s<>",;\\@]+\.[^\s<>",;\\@]+$/;

export function isValidEmail(value: unknown): value is string {
	return typeof value === "string" && value.length <= 254 && EMAIL_PATTERN.test(value);
}

/** Build the `Name <address>` form Resend expects, dropping characters that could break the header. */
export function formatSender(email: string, name?: string | null): string {
	const cleanName = (name ?? "")
		.replace(/[\r\n]+/g, " ")
		.replace(/[<>"\\]/g, "")
		.trim();
	return cleanName ? `${cleanName} <${email}>` : email;
}

/** Build the email:deliver handler. Exported for tests. */
export function createResendDeliver(): (
	event: EmailDeliverEvent,
	ctx: PluginContext,
) => Promise<void> {
	return async (event, ctx) => {
		const { message } = event;

		if (!ctx.http) {
			throw new Error(
				`[${PLUGIN_ID}] network access is unavailable. The plugin needs the "network:request" capability.`,
			);
		}

		const apiKey = await ctx.settings.get<string>("apiKey");
		if (!apiKey) {
			throw new Error(
				`[${PLUGIN_ID}] Resend API key is not set. Add it under Plugins → Resend Email → settings.`,
			);
		}

		const fromEmail = await ctx.settings.get<string>("fromEmail");
		if (!isValidEmail(fromEmail)) {
			throw new Error(
				`[${PLUGIN_ID}] "From email" is missing or invalid. Set an address on a domain verified in Resend.`,
			);
		}
		const fromName = await ctx.settings.get<string>("fromName");
		const configuredReplyTo = await ctx.settings.get<string>("replyTo");
		const brandName = await ctx.settings.get<string>("brandName");
		const brandColor = await ctx.settings.get<string>("brandColor");
		const accentColor = await ctx.settings.get<string>("accentColor");

		// A per-message reply-to (set by a plugin) wins over the configured one.
		const replyTo = message.replyTo ?? (isValidEmail(configuredReplyTo) ? configuredReplyTo : undefined);

		// Every message gets the branded layout, built from its plain-text body.
		const html = renderBrandedEmail(message, {
			name: brandName?.trim() || fromName?.trim() || fromEmail.split("@")[1],
			color: isHexColor(brandColor) ? brandColor : null,
			accent: isHexColor(accentColor) ? accentColor : null,
		});

		const response = await ctx.http.fetch(RESEND_API_URL, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: formatSender(fromEmail, fromName),
				to: [message.to],
				...(message.cc?.length ? { cc: message.cc } : {}),
				...(replyTo ? { reply_to: replyTo } : {}),
				subject: message.subject,
				text: message.text,
				html,
			}),
		});

		if (!response.ok) {
			const detail = (await response.text()).slice(0, 300);
			throw new Error(`[${PLUGIN_ID}] Resend rejected the message (HTTP ${response.status}): ${detail}`);
		}

		const result = (await response.json().catch(() => ({}))) as { id?: string };
		ctx.log.info("Email delivered via Resend", { source: event.source, messageId: result.id });
	};
}

/** Descriptor for `astro.config.mjs`. All configuration is entered in the admin. */
export function resendEmail(): PluginDescriptor {
	return {
		id: PLUGIN_ID,
		version: VERSION,
		format: "native",
		entrypoint: ENTRYPOINT,
		capabilities: [...CAPABILITIES],
		allowedHosts: ALLOWED_HOSTS,
	};
}

export function createPlugin() {
	return definePlugin({
		id: PLUGIN_ID,
		version: VERSION,
		capabilities: [...CAPABILITIES],
		allowedHosts: ALLOWED_HOSTS,
		admin: {
			settingsSchema: {
				apiKey: {
					type: "secret",
					label: "Resend API key",
					description: "Create a sending-access key at resend.com/api-keys. Stored encrypted.",
				},
				fromEmail: {
					type: "email",
					label: "From email",
					description: "Must be on a domain verified in Resend, e.g. cms@mail.example.com.",
					placeholder: "cms@mail.example.com",
				},
				fromName: {
					type: "string",
					label: "From name",
					description: "Optional display name shown to recipients.",
				},
				replyTo: {
					type: "email",
					label: "Reply-to email",
					description: "Optional. Replies go here instead of the From address.",
				},
				brandName: {
					type: "string",
					label: "Email wordmark",
					description: "Optional. Name shown in the email header. Defaults to the From name.",
				},
				brandColor: {
					type: "string",
					label: "Email brand colour",
					description: "Optional. Header and button colour as #rrggbb, e.g. #13274a. Defaults to near-black.",
				},
				accentColor: {
					type: "string",
					label: "Email accent colour",
					description: "Optional. Thin rule under the header as #rrggbb, e.g. #d4a62a. Defaults to the brand colour.",
				},
			},
		},
		hooks: {
			"email:deliver": {
				exclusive: true,
				handler: createResendDeliver(),
			},
		},
	});
}

export default resendEmail;
