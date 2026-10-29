const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const URL_LINE = /^https?:\/\/\S+$/i;

export interface BrandOptions {
	/** Wordmark shown in the header and footer. */
	name: string;
	/** Header band and button colour (#rrggbb). */
	color?: string | null;
	/** Thin accent rule under the header (#rrggbb). */
	accent?: string | null;
}

export function isHexColor(value: unknown): value is string {
	return typeof value === "string" && HEX_COLOR.test(value);
}

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&#39;");
}

/** Black or white, whichever reads better on the given #rrggbb background. */
function readableOn(hex: string): string {
	const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
	return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#0b1220" : "#ffffff";
}

/**
 * Button labels from the HTML the sender supplied, keyed by URL. Core emails
 * carry their button text only in the HTML (`<a href="…">Sign in</a>`).
 */
function extractLinkLabels(html: string | undefined): Map<string, string> {
	const labels = new Map<string, string>();
	if (!html) return labels;
	const anchor = /<a\s[^>]*href="([^"]+)"[^>]*>([^<]{1,80})<\/a>/gi;
	for (const [, href, label] of html.matchAll(anchor)) {
		const url = href.replace(/&amp;/g, "&");
		const text = label.replace(/&amp;/g, "&").replace(/&#39;/g, "'").trim();
		if (text && !labels.has(url)) labels.set(url, text);
	}
	return labels;
}

type Block = { kind: "text"; lines: string[] } | { kind: "link"; url: string };

/** Split plain text into paragraphs and standalone-URL lines. */
function parseBlocks(text: string): Block[] {
	const blocks: Block[] = [];
	let current: string[] = [];
	const flush = () => {
		if (current.length) blocks.push({ kind: "text", lines: current });
		current = [];
	};
	for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
		const line = raw.trim();
		if (!line) flush();
		else if (URL_LINE.test(line)) {
			flush();
			blocks.push({ kind: "link", url: line });
		} else current.push(line);
	}
	flush();
	return blocks;
}

/** Wrap an email's plain-text body in a branded, client-safe HTML layout. */
export function renderBrandedEmail(
	message: { subject: string; text: string; html?: string },
	brand: BrandOptions,
): string {
	const color = isHexColor(brand.color) ? brand.color : "#111827";
	const accent = isHexColor(brand.accent) ? brand.accent : color;
	const onColor = readableOn(color);
	const name = escapeHtml(brand.name);
	const labels = extractLinkLabels(message.html);
	const font = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
	const serif = "'Instrument Serif',Georgia,'Times New Roman',serif";

	const body = parseBlocks(message.text)
		.map((block) => {
			if (block.kind === "text") {
				const inner = block.lines.map(escapeHtml).join("<br>");
				return `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1f2937;" class="ink">${inner}</p>`;
			}
			const href = escapeHtml(block.url);
			const label = escapeHtml(labels.get(block.url) ?? "Open link");
			return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 20px;"><tr><td style="border-radius:8px;background:${color};" class="btn"><a href="${href}" style="display:inline-block;padding:14px 28px;font-family:${font};font-size:16px;font-weight:600;color:${onColor};text-decoration:none;border-radius:8px;" class="btn-link">${label}</a></td></tr></table>
<p style="margin:0 0 20px;font-size:13px;line-height:1.5;color:#6b7280;word-break:break-all;" class="muted">Button not working? Copy this link into your browser:<br>${href}</p>`;
		})
		.join("\n");

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
