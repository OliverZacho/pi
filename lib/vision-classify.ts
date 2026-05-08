import { Buffer } from "node:buffer";
import type { EmailCategory } from "./admin-types";
import type { MirroredImage } from "./storage";
import { getSupabaseAdmin } from "./supabase-admin";

const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_VISION_MODEL = "claude-haiku-4-5";
const VISION_TIMEOUT_MS = 25_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const VISION_CATEGORIES: ReadonlySet<EmailCategory> = new Set([
  "sale",
  "product_launch",
  "seasonal"
]);

const SUPPORTED_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp"
]);

export type ExtractedProduct = {
  name: string | null;
  price: number | null;
  currency: string | null;
  discountPercent: number | null;
  bbox: { x: number; y: number; width: number; height: number } | null;
  sourceUrl: string | null;
};

export type VisionExtractInput = {
  category: EmailCategory;
  imageToTextRatio: number;
  mirroredAssets: MirroredImage[];
};

export type VisionExtractResult = {
  attempted: boolean;
  skippedReason?: string;
  products: ExtractedProduct[];
  imageStoragePath: string | null;
  model: string;
  error?: string;
};

function isVisionEnabled(): boolean {
  const flag = process.env.VISION_CLASSIFY_ENABLED?.toLowerCase();
  return flag === "true" || flag === "1" || flag === "yes";
}

function getVisionDailyLimit(): number {
  const raw = process.env.VISION_DAILY_LIMIT;
  if (!raw) {
    return 0;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function getVisionModel(): string {
  return (
    process.env.VISION_CLASSIFY_MODEL ??
    process.env.ANTHROPIC_MODEL ??
    DEFAULT_VISION_MODEL
  );
}

function shouldRunForCategory(input: VisionExtractInput): boolean {
  return input.imageToTextRatio > 0.6 || VISION_CATEGORIES.has(input.category);
}

function pickHeroAsset(assets: MirroredImage[]): MirroredImage | null {
  if (assets.length === 0) {
    return null;
  }
  const eligible = assets.filter(
    (asset) =>
      SUPPORTED_IMAGE_TYPES.has(asset.contentType) && asset.byteLength <= MAX_IMAGE_BYTES
  );
  if (eligible.length === 0) {
    return null;
  }
  return [...eligible].sort((a, b) => b.byteLength - a.byteLength)[0];
}

async function dailyAttemptsToday(): Promise<number> {
  const supabase = getSupabaseAdmin();
  const startOfDay = new Date();
  startOfDay.setUTCHours(0, 0, 0, 0);

  const { count, error } = await supabase
    .from("email_products")
    .select("id", { count: "exact", head: true })
    .gte("extracted_at", startOfDay.toISOString());

  if (error) {
    return 0;
  }

  return count ?? 0;
}

export async function extractProductsFromHeroImage(
  input: VisionExtractInput
): Promise<VisionExtractResult> {
  const model = getVisionModel();

  if (!isVisionEnabled()) {
    return {
      attempted: false,
      skippedReason: "vision disabled (VISION_CLASSIFY_ENABLED)",
      products: [],
      imageStoragePath: null,
      model
    };
  }

  if (!shouldRunForCategory(input)) {
    return {
      attempted: false,
      skippedReason: "category/ratio gate",
      products: [],
      imageStoragePath: null,
      model
    };
  }

  const dailyLimit = getVisionDailyLimit();
  if (dailyLimit > 0) {
    const todays = await dailyAttemptsToday();
    if (todays >= dailyLimit) {
      return {
        attempted: false,
        skippedReason: `daily budget exceeded (${todays}/${dailyLimit})`,
        products: [],
        imageStoragePath: null,
        model
      };
    }
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return {
      attempted: false,
      skippedReason: "ANTHROPIC_API_KEY not configured",
      products: [],
      imageStoragePath: null,
      model
    };
  }

  const hero = pickHeroAsset(input.mirroredAssets);
  if (!hero) {
    return {
      attempted: false,
      skippedReason: "no eligible hero image",
      products: [],
      imageStoragePath: null,
      model
    };
  }

  try {
    const imageBytes = await downloadFromStorage(hero.storagePath);
    if (!imageBytes) {
      return {
        attempted: true,
        products: [],
        imageStoragePath: hero.storagePath,
        model,
        error: "failed to download hero image from storage"
      };
    }

    const products = await callAnthropicVision({
      apiKey,
      model,
      imageBytes,
      contentType: hero.contentType
    });

    return {
      attempted: true,
      products,
      imageStoragePath: hero.storagePath,
      model
    };
  } catch (error) {
    return {
      attempted: true,
      products: [],
      imageStoragePath: hero.storagePath,
      model,
      error: error instanceof Error ? error.message : "unknown vision error"
    };
  }
}

async function downloadFromStorage(storagePath: string): Promise<Uint8Array | null> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from("email-assets").download(storagePath);
  if (error || !data) {
    return null;
  }
  const arrayBuffer = await data.arrayBuffer();
  return new Uint8Array(arrayBuffer);
}

async function callAnthropicVision(args: {
  apiKey: string;
  model: string;
  imageBytes: Uint8Array;
  contentType: string;
}): Promise<ExtractedProduct[]> {
  const base64 = Buffer.from(args.imageBytes).toString("base64");

  const body = {
    model: args.model,
    max_tokens: 1024,
    temperature: 0,
    system:
      "You analyze the hero image of a marketing email and extract products visible in the image. " +
      "Always call the extract_products tool exactly once. " +
      "If no products are visible, return an empty array. " +
      "Each product should describe what is shown in the image: product name, price (if visible), " +
      "currency code (3-letter ISO), and discount percent (0-100) when shown. " +
      "Bounding box coordinates are normalized (0-1) of the full image; omit if uncertain.",
    tools: [
      {
        name: "extract_products",
        description: "Record the products visible in the hero image of this email.",
        input_schema: {
          type: "object",
          additionalProperties: false,
          properties: {
            products: {
              type: "array",
              maxItems: 12,
              items: {
                type: "object",
                additionalProperties: false,
                properties: {
                  name: { type: ["string", "null"], maxLength: 200 },
                  price: { type: ["number", "null"], minimum: 0 },
                  currency: { type: ["string", "null"], minLength: 3, maxLength: 3 },
                  discount_percent: {
                    type: ["number", "null"],
                    minimum: 0,
                    maximum: 100
                  },
                  bbox: {
                    type: ["object", "null"],
                    additionalProperties: false,
                    properties: {
                      x: { type: "number", minimum: 0, maximum: 1 },
                      y: { type: "number", minimum: 0, maximum: 1 },
                      width: { type: "number", minimum: 0, maximum: 1 },
                      height: { type: "number", minimum: 0, maximum: 1 }
                    },
                    required: ["x", "y", "width", "height"]
                  }
                },
                required: ["name"]
              }
            }
          },
          required: ["products"]
        }
      }
    ],
    tool_choice: { type: "tool", name: "extract_products" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: args.contentType,
              data: base64
            }
          },
          {
            type: "text",
            text: "Identify the products visible in this email hero image. Return structured JSON via the extract_products tool."
          }
        ]
      }
    ]
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), VISION_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": args.apiKey,
        "anthropic-version": ANTHROPIC_VERSION
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`anthropic vision http ${response.status}: ${text.slice(0, 300)}`);
  }

  const json = (await response.json()) as {
    content?: Array<{ type: string; name?: string; input?: Record<string, unknown> }>;
  };

  const toolBlock = json.content?.find(
    (block) => block.type === "tool_use" && block.name === "extract_products"
  );

  if (!toolBlock || !toolBlock.input) {
    throw new Error("anthropic vision returned no tool_use block");
  }

  const productsRaw = toolBlock.input["products"];
  if (!Array.isArray(productsRaw)) {
    return [];
  }

  return productsRaw.map((entry): ExtractedProduct => {
    const candidate = (entry ?? {}) as Record<string, unknown>;
    const bboxRaw = candidate["bbox"];
    const bbox =
      bboxRaw && typeof bboxRaw === "object" && !Array.isArray(bboxRaw)
        ? readBbox(bboxRaw as Record<string, unknown>)
        : null;
    return {
      name: typeof candidate.name === "string" ? candidate.name.slice(0, 200) : null,
      price: numericOrNull(candidate.price, 0, 1_000_000),
      currency: normalizeCurrency(candidate.currency),
      discountPercent: numericOrNull(candidate.discount_percent, 0, 100),
      bbox,
      sourceUrl: null
    };
  });
}

function numericOrNull(value: unknown, min: number, max: number): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }
  return Math.max(min, Math.min(max, n));
}

function normalizeCurrency(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function readBbox(value: Record<string, unknown>): ExtractedProduct["bbox"] {
  const x = numericOrNull(value.x, 0, 1);
  const y = numericOrNull(value.y, 0, 1);
  const width = numericOrNull(value.width, 0, 1);
  const height = numericOrNull(value.height, 0, 1);
  if (x === null || y === null || width === null || height === null) {
    return null;
  }
  return { x, y, width, height };
}

export async function persistExtractedProducts(
  emailId: string,
  result: VisionExtractResult
): Promise<{ inserted: number }> {
  if (!result.attempted || result.products.length === 0) {
    return { inserted: 0 };
  }

  const supabase = getSupabaseAdmin();
  const rows = result.products.map((product) => ({
    email_id: emailId,
    name: product.name,
    price: product.price,
    currency: product.currency,
    discount_percent: product.discountPercent,
    image_storage_path: result.imageStoragePath,
    source_url: product.sourceUrl,
    bbox: product.bbox
  }));

  const { error } = await supabase.from("email_products").insert(rows);
  if (error) {
    throw new Error(`failed to persist email_products: ${error.message}`);
  }

  return { inserted: rows.length };
}
