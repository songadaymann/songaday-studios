// Cloudflare Turnstile's server-side check, shared by Fumble and commissions.
// TURNSTILE_SITE_KEY is in wrangler.jsonc; TURNSTILE_SECRET_KEY is a Worker secret.

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// True when Turnstile says this token came from a person, for this widget's action.
export async function isHuman(env, token, action) {
  if (typeof token !== 'string' || !token || token.length > 2048) return false;
  try {
    const response = await fetch(SITEVERIFY, {
      method: 'POST',
      body: new URLSearchParams({ secret: env.TURNSTILE_SECRET_KEY, response: token }),
      signal: AbortSignal.timeout(5000)
    });
    const outcome = await response.json();
    // Turnstile's test keys answer without an action; real widgets report data-action.
    return outcome.success === true && (!outcome.action || outcome.action === action);
  } catch {
    return false;
  }
}
