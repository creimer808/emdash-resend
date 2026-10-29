import { describe, expect, it } from "vitest";
import { escapeHtml, isHexColor, renderBrandedEmail } from "./template";

const magic = {
	subject: "Sign in to Colorado Kingsmen",
	text: "Click the link below to sign in.\n\nhttps://example.com/auth?token=a&b=1\n\nThis link expires in 15 minutes.\n\nIf you didn't request this, ignore it.",
	html: '<a href="https://example.com/auth?token=a&amp;b=1" style="x">Sign in</a>',
};

describe("renderBrandedEmail", () => {
	it("renders the wordmark, subject, paragraphs and a labelled button", () => {
		const html = renderBrandedEmail(magic, { name: "Colorado Kingsmen", color: "#13274a", accent: "#d4a62a" });
		expect(html).toContain("Colorado Kingsmen");
		expect(html).toContain("Sign in to Colorado Kingsmen</h1>");
		expect(html).toContain("This link expires in 15 minutes.");
		expect(html).toContain('href="https://example.com/auth?token=a&amp;b=1"');
		expect(html).toMatch(/>Sign in<\/a>/);
		expect(html).toContain("#13274a");
		expect(html).toContain("#d4a62a");
	});

	it("falls back to a generic label and neutral colours", () => {
		const html = renderBrandedEmail({ ...magic, html: undefined }, { name: "Site" });
		expect(html).toMatch(/>Open link<\/a>/);
		expect(html).toContain("#111827");
	});

	it("ignores invalid colours instead of injecting them", () => {
		const html = renderBrandedEmail(magic, { name: "Site", color: "red;} body{display:none", accent: "url(x)" });
		expect(html).not.toContain("display:none");
		expect(html).not.toContain("url(x)");
	});

	it("escapes the name, subject and body text", () => {
		const html = renderBrandedEmail(
			{ subject: "<script>1</script>", text: "<img src=x onerror=1>" },
			{ name: '"><b>x</b>' },
		);
		expect(html).not.toContain("<script>");
		expect(html).not.toContain("<img");
		expect(html).not.toContain("<b>x</b>");
	});

	it("does not turn non-http links into buttons", () => {
		const html = renderBrandedEmail({ subject: "s", text: "javascript:alert(1)" }, { name: "Site" });
		expect(html).not.toContain("<a ");
	});

	it("keeps an invite's instruction line and link together as text then button", () => {
		const html = renderBrandedEmail(
			{ subject: "Invite", text: "You're invited.\n\nAccept here:\nhttps://example.com/i/1\n\nExpires soon." },
			{ name: "Site" },
		);
		expect(html.indexOf("Accept here:")).toBeLessThan(html.indexOf('href="https://example.com/i/1"'));
	});
});

describe("helpers", () => {
	it("validates hex colours", () => {
		expect(isHexColor("#13274a")).toBe(true);
		expect(isHexColor("#fff")).toBe(false);
		expect(isHexColor(null)).toBe(false);
	});
	it("escapes html", () => {
		expect(escapeHtml(`<&>"'`)).toBe("&lt;&amp;&gt;&quot;&#39;");
	});
});
