// Minimal edge function to verify Vercel deploys /api functions at all.
export const config = { runtime: "edge" };

export default function handler(): Response {
  return new Response(JSON.stringify({ ok: true, at: "api/ping" }), {
    headers: { "Content-Type": "application/json" },
  });
}
