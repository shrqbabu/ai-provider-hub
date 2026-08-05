import type { ConnectedProvider, DiscoveredModel } from "@/types";
import { createClient, extractErrorMessage } from "./provider-service";

export interface ImageGenHandlers {
  onDone: (images: string[], durationMs: number) => void;
  onError: (err: Error) => void;
  signal?: AbortSignal;
}

export interface ImageGenOptions {
  n?: number;
  size?: string;
}

// Heuristic: does this model ID look like a text-to-image generation model?
// Used to decide whether to show the "Create image" toggle in the composer.
const IMAGE_MODEL_RE =
  /(dall-?e|gpt-image|flux|stable-?diffusion|sdxl|sd-?[0-9]|sd3|playground-v|imagen|kandinsky|kolors|recraft|ideogram|seedream|hidream|wan|luma|midjourney|pixart|janus|omnigen|infinity|nvidia\/sdxl|black-forest-labs)/i;

export function isImageModel(modelId: string): boolean {
  return IMAGE_MODEL_RE.test(modelId);
}

// Normalize one item from an OpenAI-compatible /images/generations response
// into something an <img src> can render. Providers return either a hosted
// URL or base64 (b64_json) — we turn base64 into a data URL.
function itemToSrc(item: unknown): string | null {
  if (!item || typeof item !== "object") return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const it = item as any;
  if (typeof it.url === "string" && it.url) return it.url;
  if (typeof it.b64_json === "string" && it.b64_json) {
    return `data:image/png;base64,${it.b64_json}`;
  }
  return null;
}

// Generate images through an OpenAI-compatible POST /images/generations.
// Uses the same proxied client as chat so auth + CORS behave identically.
export async function generateImages(
  provider: ConnectedProvider,
  model: DiscoveredModel,
  prompt: string,
  handlers: ImageGenHandlers,
  options: ImageGenOptions = {}
): Promise<void> {
  const start = performance.now();
  try {
    const client = createClient(provider);
    const n = Math.min(Math.max(options.n ?? 1, 1), 4);

    // Build the request. `size` is optional — some servers reject unknown
    // sizes, so only send it when the caller asked for one.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body: Record<string, any> = {
      model: model.modelId,
      prompt,
      n,
    };
    if (options.size) body.size = options.size;

    const res = await client.images.generate(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      body as any,
      { signal: handlers.signal }
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = (res as any)?.data;
    const images: string[] = Array.isArray(data)
      ? data.map(itemToSrc).filter((s): s is string => !!s)
      : [];

    if (images.length === 0) {
      throw new Error(
        "The provider returned no images. This model may not support image generation."
      );
    }

    handlers.onDone(images, Math.round(performance.now() - start));
  } catch (err: unknown) {
    if ((err as { name?: string })?.name === "AbortError") {
      handlers.onDone([], Math.round(performance.now() - start));
      return;
    }
    handlers.onError(new Error(extractErrorMessage(err)));
  }
}
