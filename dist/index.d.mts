import { PluginContext, PluginDescriptor } from "emdash";
import { EmailDeliverEvent } from "emdash/plugin";
export declare function isValidEmail(value: unknown): value is string;
/** Build the `Name <address>` form Resend expects, dropping characters that could break the header. */
export declare function formatSender(email: string, name?: string | null): string;
/** Build the email:deliver handler. Exported for tests. */
export declare function createResendDeliver(): (event: EmailDeliverEvent, ctx: PluginContext) => Promise<void>;
/** Descriptor for `astro.config.mjs`. All configuration is entered in the admin. */
export declare function resendEmail(): PluginDescriptor;
export declare function createPlugin(): import("emdash").ResolvedPlugin<import("emdash").PluginStorageConfig>;
export { resendEmail as default };