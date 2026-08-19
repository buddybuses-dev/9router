// Whop sourcing.
//
// Two modes, deliberately:
//
//   manual  — products listed in config/whop.sources.json. Always available, needs no
//             credentials, and is the mode you should actually run on. A product you
//             have vetted yourself is the only kind you can make an honest video about.
//
//   api     — your own Whop company's products via the Whop REST API (needs WHOP_API_KEY).
//             Use this when you run your own Whop or have API access to the ones you
//             promote, so pricing and titles stay in sync automatically.
//
// There is deliberately no marketplace-wide scraper here. Whop has no public discovery
// API for third parties, and a scraper against their storefront would break on every
// markup change and sits on the wrong side of their terms. If you want breadth, widen
// manualProducts — vetting is the bottleneck worth keeping, not the API.

import { requestJson } from '../lib/http.js';
import { optional } from '../lib/env.js';
import { logger } from '../lib/log.js';

const log = logger('source:whop');
const API_BASE = optional('WHOP_API_BASE', 'https://api.whop.com/api/v2');

/** Shape every source must return, so adding a second marketplace later is additive. */
function normalize(raw) {
  return {
    type: 'whop',
    productId: String(raw.productId ?? raw.id ?? ''),
    name: raw.name ?? raw.title ?? 'Untitled product',
    url: raw.url ?? raw.route ?? '',
    affiliateUrl: raw.affiliateUrl ?? '',
    priceLabel: raw.priceLabel ?? '',
    category: raw.category ?? '',
    angleNotes: raw.angleNotes ?? '',
    rating: raw.rating ?? null,
    reviewCount: raw.reviewCount ?? null,
  };
}

export function loadManual(sourcesConfig) {
  const products = (sourcesConfig.manualProducts ?? [])
    .filter((p) => p.enabled !== false)
    .map(normalize);
  log.info('loaded manual products', { count: products.length });
  return products;
}

export async function loadFromApi(sourcesConfig) {
  const apiKey = optional('WHOP_API_KEY');
  if (!apiKey) {
    log.info('WHOP_API_KEY not set, skipping API sourcing');
    return [];
  }

  const payload = await requestJson(`${API_BASE}/products?per=50`, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
  });

  // The API wraps its list differently across versions; accept either shape rather
  // than hard-failing the whole run on an envelope change.
  const rows = Array.isArray(payload) ? payload : payload?.data ?? payload?.products ?? [];
  if (!Array.isArray(rows)) {
    log.warn('unexpected Whop API response shape, skipping', { keys: Object.keys(payload ?? {}) });
    return [];
  }

  const products = rows.map((row) =>
    normalize({
      productId: row.id,
      name: row.name ?? row.title,
      url: row.route ? `https://whop.com/${row.route}` : row.url,
      priceLabel: formatPrice(row),
      category: row.category ?? '',
    }),
  );
  log.info('loaded products from Whop API', { count: products.length });
  return products;
}

function formatPrice(row) {
  const amount = row.price ?? row.initial_price ?? row.renewal_price;
  if (amount === undefined || amount === null) return '';
  const currency = (row.currency ?? 'usd').toUpperCase();
  const period = row.billing_period ? `/${row.billing_period}` : '';
  return `${currency} ${amount}${period}`;
}

/** Filters that keep the queue honest: nothing excluded, nothing unvetted, nothing off-brand. */
export function applyFilters(products, sourcesConfig) {
  const { discovery = {}, exclude = {} } = sourcesConfig;
  const bannedWords = (exclude.keywords ?? []).map((k) => k.toLowerCase());
  const bannedIds = new Set(exclude.productIds ?? []);

  return products.filter((product) => {
    if (bannedIds.has(product.productId)) {
      log.debug('excluded by id', { id: product.productId });
      return false;
    }
    const haystack = `${product.name} ${product.category} ${product.angleNotes}`.toLowerCase();
    const hit = bannedWords.find((word) => haystack.includes(word));
    if (hit) {
      log.info('excluded by keyword', { product: product.name, keyword: hit });
      return false;
    }
    if (discovery.minRating && product.rating !== null && product.rating < discovery.minRating) {
      return false;
    }
    if (
      discovery.minReviewCount &&
      product.reviewCount !== null &&
      product.reviewCount < discovery.minReviewCount
    ) {
      return false;
    }
    return true;
  });
}

export async function collect(sourcesConfig) {
  const manual = loadManual(sourcesConfig);
  const fromApi = await loadFromApi(sourcesConfig);

  // Manual entries win on conflict — they carry your vetting notes.
  const byId = new Map();
  for (const product of [...fromApi, ...manual]) {
    if (product.productId) byId.set(product.productId, product);
  }
  return applyFilters([...byId.values()], sourcesConfig);
}
