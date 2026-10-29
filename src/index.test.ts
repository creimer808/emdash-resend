import { describe, expect, it, vi } from "vitest";
import { createResendDeliver, formatSender, isValidEmail } from "./index";

type Settings = Record<string, unknown>;

function makeCtx(settings: Settings, fetchImpl?: ReturnType<typeof vi.fn>) {
	const fetch =
		fetchImpl ??
		vi.fn(async () => new Response(JSON.stringify({ id: "msg_1" }), { status: 200 }));
	const ctx = {
		settings: { get: async (key: string) => settings[key] ?? null },
		http: { fetch },
		log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
	};
	return { ctx: ctx as never, fetch, log: ctx.log };
}

const event = (message: Partial<{ to: string; cc: string[]; replyTo: string }> = {}) =>
	({
		source: "system",
		message: { to: "user@example.com", subject: "Hi", text: "Body", ...message },
	}) as never;

const good = { apiKey: "re_test_key", fromEmail: "cms@mail.example.com", fromName: "My Site" };

describe("deliver", () => {
	it("posts to the Resend API with the stored key and sender", async () => {
		const { ctx, fetch } = makeCtx(good);
		await createResendDeliver()(event(), ctx);
		expect(fetch).toHaveBeenCalledTimes(1);
		const [url, init] = fetch.mock.calls[0];
		expect(url).toBe("https://api.resend.com/emails");
		expect(init.headers.Authorization).toBe("Bearer re_test_key");
		const body = JSON.parse(init.body);
		expect(body).toMatchObject({
			from: "My Site <cms@mail.example.com>",
			to: ["user@example.com"],
			subject: "Hi",
			text: "Body",
		});
	});

	it("uses the configured reply-to, but a per-message one wins", async () => {
		const withReply = { ...good, replyTo: "hello@example.com" };
		const a = makeCtx(withReply);
		await createResendDeliver()(event(), a.ctx);
		expect(JSON.parse(a.fetch.mock.calls[0][1].body).reply_to).toBe("hello@example.com");
		const b = makeCtx(withReply);
		await createResendDeliver()(event({ replyTo: "other@example.com" }), b.ctx);
		expect(JSON.parse(b.fetch.mock.calls[0][1].body).reply_to).toBe("other@example.com");
	});

	it("forwards cc recipients", async () => {
		const { ctx, fetch } = makeCtx(good);
		await createResendDeliver()(event({ cc: ["c@example.com"] }), ctx);
		expect(JSON.parse(fetch.mock.calls[0][1].body).cc).toEqual(["c@example.com"]);
	});

	it("fails clearly when the API key is missing, without calling out", async () => {
		const { ctx, fetch } = makeCtx({ fromEmail: good.fromEmail });
		await expect(createResendDeliver()(event(), ctx)).rejects.toThrow(/API key is not set/);
		expect(fetch).not.toHaveBeenCalled();
	});

	it("fails when From email is missing or invalid", async () => {
		for (const fromEmail of [undefined, "not-an-email", "a@b.co>\r\nBcc: x@y.z"]) {
			const { ctx, fetch } = makeCtx({ apiKey: "k", fromEmail });
			await expect(createResendDeliver()(event(), ctx)).rejects.toThrow(/From email/);
			expect(fetch).not.toHaveBeenCalled();
		}
	});

	it("surfaces Resend errors without leaking the API key", async () => {
		const fetch = vi.fn(async () => new Response('{"message":"domain not verified"}', { status: 403 }));
		const { ctx } = makeCtx(good, fetch);
		const err = await createResendDeliver()(event(), ctx).catch((e: Error) => e);
		expect(err).toBeInstanceOf(Error);
		expect((err as Error).message).toMatch(/HTTP 403/);
		expect((err as Error).message).toMatch(/domain not verified/);
		expect((err as Error).message).not.toContain("re_test_key");
	});

	it("never logs the API key", async () => {
		const { ctx, log } = makeCtx(good);
		await createResendDeliver()(event(), ctx);
		expect(JSON.stringify(log.info.mock.calls)).not.toContain("re_test_key");
	});
});

describe("helpers", () => {
	it("strips header-breaking characters from the display name", () => {
		expect(formatSender("a@b.co", 'Evil" <x@y.z>\r\nBcc: q')).toBe("Evil x@y.z Bcc: q <a@b.co>");
		expect(formatSender("a@b.co", "")).toBe("a@b.co");
	});

	it("validates single email addresses", () => {
		expect(isValidEmail("cms@mail.example.com")).toBe(true);
		expect(isValidEmail("a@b")).toBe(false);
		expect(isValidEmail("a b@c.co")).toBe(false);
		expect(isValidEmail("a@c.co, b@c.co")).toBe(false);
		expect(isValidEmail(42)).toBe(false);
	});
});
