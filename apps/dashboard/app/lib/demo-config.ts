/**
 * Environment configuration for the Demo Channel.
 *
 * When false, every demo route returns 404.
 * Must be false by default in production builds.
 */
export function isDemoChannelEnabled(): boolean {
  return process.env.DEMO_CHANNEL_ENABLED === "true";
}
