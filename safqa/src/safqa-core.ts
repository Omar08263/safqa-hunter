// Copied from github.com/Omar08263/safqa apps/edge/src/catalog/core.ts so the hunter and the Worker compute identical match keys.
// Safqa v5 catalog core: Arabic/English normalisation, spec parsing, cross-store
// matching keys, rule-based categorisation and schema.org / OpenGraph extraction.
// Self-contained (no imports) so the Worker and the Node crawler share it.

export interface Category { slug: string; ar: string; en: string; emoji: string }
export const CATEGORIES: Category[] = [
  { slug: 'phones', ar: 'موبايلات', en: 'Phones', emoji: '📱' },
  { slug: 'tablets', ar: 'تابلت', en: 'Tablets', emoji: '📲' },
  { slug: 'laptops', ar: 'لابتوبات', en: 'Laptops', emoji: '💻' },
  { slug: 'computing', ar: 'كمبيوتر وقطع', en: 'PC & parts', emoji: '🖥️' },
  { slug: 'tvs', ar: 'شاشات', en: 'TVs & monitors', emoji: '📺' },
  { slug: 'audio', ar: 'صوتيات', en: 'Audio', emoji: '🎧' },
  { slug: 'lifestyle', ar: 'ساعات ذكية', en: 'Wearables', emoji: '⌚' },
  { slug: 'gaming', ar: 'ألعاب', en: 'Gaming', emoji: '🎮' },
  { slug: 'cameras', ar: 'كاميرات', en: 'Cameras', emoji: '📷' },
  { slug: 'networking', ar: 'شبكات', en: 'Networking', emoji: '📶' },
  { slug: 'appliances', ar: 'أجهزة منزلية', en: 'Home appliances', emoji: '🧺' },
  { slug: 'kitchen', ar: 'أجهزة المطبخ', en: 'Kitchen', emoji: '🍳' },
  { slug: 'personal-care', ar: 'عناية شخصية', en: 'Personal care', emoji: '💈' },
  { slug: 'smart-home', ar: 'بيت ذكي', en: 'Smart home', emoji: '🏠' },
  { slug: 'accessories', ar: 'إكسسوارات', en: 'Accessories', emoji: '🔌' },
];
export const categoryBySlug = (s: string | null | undefined) => CATEGORIES.find((c) => c.slug === s) ?? null;

const AR_DIGITS: Record<string, string> = { '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9', '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9' };

/** Lowercase, Latin digits, unify Arabic letter variants, drop diacritics/tatweel/punctuation. */
export function normAr(s: string | null | undefined): string {
  if (!s) return '';
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[٠-٩۰-۹]/g, (d) => AR_DIGITS[d] ?? d)
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}+.]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Arabic spellings people type → canonical Latin token (search + matching both directions).
export const SYNONYMS: [string, string][] = [
  ['سامسونج', 'samsung'], ['سامسونغ', 'samsung'], ['جالاكسي', 'galaxy'], ['جلاكسي', 'galaxy'], ['جالكسي', 'galaxy'], ['جالكسى', 'galaxy'], ['ابل', 'apple'], ['ايفون', 'iphone'], ['آيفون', 'iphone'],
  ['ايباد', 'ipad'], ['ماك بوك', 'macbook'], ['ماكبوك', 'macbook'], ['ايربودز', 'airpods'], ['شاومي', 'xiaomi'], ['شیاومی', 'xiaomi'], ['ريدمي', 'redmi'], ['بوكو', 'poco'],
  ['اوبو', 'oppo'], ['ريلمي', 'realme'], ['فيفو', 'vivo'], ['هواوي', 'huawei'], ['هونر', 'honor'], ['انفنكس', 'infinix'], ['انفينكس', 'infinix'], ['تكنو', 'tecno'],
  ['نوكيا', 'nokia'], ['موتورولا', 'motorola'], ['لينوفو', 'lenovo'], ['ديل', 'dell'], ['اتش بي', 'hp'], ['اسوس', 'asus'], ['ايسر', 'acer'], ['ام اس اي', 'msi'],
  ['سوني', 'sony'], ['بلايستيشن', 'playstation'], ['بلاي ستيشن', 'playstation'], ['اكس بوكس', 'xbox'], ['نينتندو', 'nintendo'], ['ال جي', 'lg'], ['توشيبا', 'toshiba'],
  ['شارب', 'sharp'], ['تورنيدو', 'tornado'], ['فريش', 'fresh'], ['بيكو', 'beko'], ['زانوسي', 'zanussi'], ['وايت بوينت', 'white point'], ['يونيفرسال', 'universal'],
  ['انكر', 'anker'], ['جي بي ال', 'jbl'], ['بوز', 'bose'], ['جارمن', 'garmin'], ['كانون', 'canon'], ['نيكون', 'nikon'], ['فيليبس', 'philips'], ['براون', 'braun'],
  ['تي بي لينك', 'tp-link'], ['شاشه', 'tv'], ['تلفزيون', 'tv'], ['تليفزيون', 'tv'], ['موبايل', 'phone'], ['تليفون', 'phone'], ['هاتف', 'phone'], ['لابتوب', 'laptop'],
  ['لاب توب', 'laptop'], ['سماعه', 'headphones'], ['سماعات', 'headphones'], ['ساعه', 'watch'], ['تابلت', 'tablet'], ['غساله', 'washer'], ['ثلاجه', 'fridge'],
  ['تكييف', 'air conditioner'], ['مكيف', 'air conditioner'], ['شاحن', 'charger'], ['باور بانك', 'power bank'], ['كاميرا', 'camera'], ['راوتر', 'router'], ['ماوس', 'mouse'],
  ['كيبورد', 'keyboard'], ['برو', 'pro'], ['ماكس', 'max'], ['الترا', 'ultra'], ['بلس', 'plus'], ['ميني', 'mini'], ['جيجا', 'gb'], ['تيرا', 'tb'],
];
const SYN_NORM = SYNONYMS.map(([a, b]) => [normAr(a), b] as const).sort((x, y) => y[0].length - x[0].length);

/** normAr + Arabic brand/product words mapped to their Latin tokens (kept alongside the originals). */
export function searchText(...parts: (string | null | undefined)[]): string {
  const base = normAr(parts.filter(Boolean).join(' '));
  const extra: string[] = [];
  for (const [ar, en] of SYN_NORM) if (base.includes(ar)) extra.push(en);
  return extra.length ? `${base} ${extra.join(' ')}` : base;
}

/** Normalise a user query: Arabic words become the Latin tokens they stand for. */
export function normQuery(q: string): string {
  let s = ` ${normAr(q)} `;
  for (const [ar, en] of SYN_NORM) s = s.split(` ${ar} `).join(` ${en} `);
  return s.replace(/(\d+)\s*(gb|tb|جيجا|تيرا)/g, '$1$2').replace(/\s+/g, ' ').trim();
}

const MODEL_WORDS = new Set(['ti', 'super', 'xt', 'xtx', 'oc', 'gt', 'gts', 'evo', 'plus', 's', 'e', 'x', 'iphone', 'ipad', 'macbook', 'air', 'pro', 'max', 'ultra', 'plus', 'mini', 'lite', 'fe', 'note', 'galaxy', 'redmi', 'poco', 'pixel', 'reno', 'find', 'nova', 'mate', 'watch', 'buds', 'airpods', 'tab', 'pad', 'fold', 'flip', 'edge', 'neo', 'prime', 'spark', 'camon', 'hot', 'zero', 'smart', 'oled', 'qled', 'neo', 'slim', 'digital', 'disc', 'se', 'elitebook', 'thinkpad', 'ideapad', 'vivobook', 'zenbook', 'probook', 'latitude', 'precision', 'inspiron', 'vostro', 'legion', 'yoga', 'pavilion', 'victus', 'omen', 'nitro', 'aspire', 'swift', 'rog', 'tuf', 'strix', 'zephyrus']);
const CONDITION_WORDS = new Set(['used', 'refurbished', 'renewed', 'original', 'open', 'box', 'grade']);
export type Condition = 'new' | 'used' | 'refurbished';
export function condition(title: string): Condition {
  const t = normAr(title);
  if (/\b(refurbished|renewed|refurb)\b|مجدد/.test(t)) return 'refurbished';
  if (/\b(used|open box|pre ?owned|second hand)\b|مستعمل/.test(t)) return 'used';
  return 'new';
}

export interface Specs { storageGb?: number; ramGb?: number; inches?: number; color?: string; tokens: string[] }
const COLORS = ['black', 'white', 'silver', 'gold', 'blue', 'green', 'red', 'purple', 'pink', 'gray', 'grey', 'titanium', 'graphite', 'midnight', 'starlight', 'yellow', 'orange', 'cream', 'violet', 'lavender', 'mint', 'natural', 'desert'];
const STOP = new Set(['with', 'and', 'the', 'for', 'new', 'original', 'dual', 'sim', 'version', 'edition', 'wifi', 'wi', 'fi', 'lte', '4g', '5g', 'mobile', 'phone', 'smartphone', 'smart', 'inch', 'in', 'of', 'by', 'gb', 'tb', 'ram', 'rom', 'storage', 'memory', 'international', 'egypt', 'warranty', 'official', 'nfc', 'mah']);

export function parseSpecs(title: string): Specs {
  const t = normQuery(title).replace(/(\d+)\s+(gb|tb)/g, '$1$2');
  const out: Specs = { tokens: [] };
  const caps = [...t.matchAll(/(\d+(?:\.\d+)?)(gb|tb)/g)].map((m) => Number(m[1]) * (m[2] === 'tb' ? 1024 : 1));
  const ramM = t.match(/(\d+)gb\s*ram|ram\s*(\d+)gb|(\d+)\s*\+\s*(\d+)gb/);
  if (ramM) {
    if (ramM[3] && ramM[4]) { out.ramGb = Number(ramM[3]); out.storageGb = Number(ramM[4]); }
    else out.ramGb = Number(ramM[1] ?? ramM[2]);
  }
  if (!out.storageGb && caps.length) {
    const big = caps.filter((c) => c >= 16 && c !== out.ramGb);
    if (big.length) out.storageGb = Math.max(...big);
    if (!out.ramGb) { const small = caps.filter((c) => c <= 24 && c !== out.storageGb); if (small.length) out.ramGb = Math.max(...small); }
  }
  const inch = t.match(/(\d{2}(?:\.\d)?)\s*(?:inch|in\b|"|بوصه)/);
  if (inch) out.inches = Number(inch[1]);
  out.color = COLORS.find((c) => new RegExp(`\\b${c}\\b`).test(t));
  out.tokens = t.split(' ').filter((w) => w.length > 0 && !STOP.has(w) && !COLORS.includes(w) && !/^\d+(gb|tb)$/.test(w) && !/^[\u0600-\u06FF]+$/.test(w));
  return out;
}

const KNOWN_BRANDS = ['apple', 'samsung', 'xiaomi', 'redmi', 'poco', 'oppo', 'realme', 'vivo', 'huawei', 'honor', 'infinix', 'tecno', 'itel', 'nokia', 'motorola', 'google', 'oneplus', 'nothing',
  'lenovo', 'dell', 'hp', 'asus', 'acer', 'msi', 'microsoft', 'sony', 'lg', 'toshiba', 'sharp', 'tornado', 'fresh', 'beko', 'zanussi', 'white point', 'universal', 'kiriazi', 'ariston', 'bosch',
  'anker', 'jbl', 'bose', 'garmin', 'canon', 'nikon', 'philips', 'braun', 'tp-link', 'dji', 'gopro', 'logitech', 'razer', 'redragon', 'hyperx', 'corsair', 'steelseries', 'nintendo',
  'playstation', 'xbox', 'kingston', 'sandisk', 'seagate', 'wd', 'western digital', 'crucial', 'intel', 'amd', 'nvidia', 'gigabyte', 'zte', 'oraimo', 'baseus', 'ugreen', 'belkin', 'amazfit', 'haylou', 'soundcore', 'marshall', 'beats', 'tcl', 'hisense', 'jac', 'unionaire', 'kenwood', 'moulinex', 'tefal', 'black+decker', 'black & decker', 'panasonic', 'remington', 'sencor', 'midea', 'carrier', 'gree', 'mienta', 'zero', 'otterbox'];

export function guessBrand(title: string, given?: string | null): string | null {
  const g = normAr(given ?? '');
  if (g && g !== 'generic' && g !== 'other' && g.length < 30) return g;
  const t = searchText(title);
  for (const b of KNOWN_BRANDS) if (new RegExp(`(^|\\s)${b.replace(/[+&]/g, '\\$&')}(\\s|$)`).test(t)) return b;
  for (const [re, b] of LINE_BRANDS) if (re.test(t)) return b;
  return null;
}
/** Product lines that imply the brand when the title omits it ("Galaxy A55" → samsung). */
const LINE_BRANDS: [RegExp, string][] = [
  [/(^|\s)galaxy(\s|$)/, 'samsung'], [/(^|\s)(iphone|ipad|macbook|airpods|imac)(\s|$)/, 'apple'], [/(^|\s)(redmi|poco)(\s|$)/, 'xiaomi'],
  [/(^|\s)pixel(\s|$)/, 'google'], [/(^|\s)(ideapad|thinkpad|thinkbook|legion|yoga)(\s|$)/, 'lenovo'], [/(^|\s)(pavilion|victus|omen|elitebook|probook)(\s|$)/, 'hp'],
  [/(^|\s)(vivobook|zenbook|rog|tuf)(\s|$)/, 'asus'], [/(^|\s)(inspiron|latitude|vostro|alienware)(\s|$)/, 'dell'], [/(^|\s)(aspire|nitro|predator|swift)(\s|$)/, 'acer'],
];

/**
 * Cross-store match key. GTIN wins; otherwise brand + model tokens + storage/RAM (variants never merge).
 * Colour is ignored (same price across colours at most stores) unless the title is only a colour variant.
 */
export function matchKey(o: { title: string; brand?: string | null; gtin?: string | null; mpn?: string | null }): string {
  const gtin = (o.gtin ?? '').replace(/\D/g, '');
  if (gtin.length >= 8 && !/^0+$/.test(gtin)) return `g:${gtin.padStart(14, '0')}`;
  const brand = guessBrand(o.title, o.brand) ?? 'x';
  const mpn = normAr(o.mpn ?? '').replace(/\s/g, '');
  if (mpn.length >= 5 && /\d/.test(mpn) && /[a-z]/.test(mpn)) return `m:${brand}:${mpn}`;
  const s = parseSpecs(o.title);
  const all = [...new Set(s.tokens.filter((w) => w !== brand && !brand.split(' ').includes(w) && !CONDITION_WORDS.has(w)))];
  // Model-ish tokens (contain a digit, or are product-line words) identify the product across stores;
  // marketing words ("frameless", "fhd") differ per store and are ignored when model tokens exist.
  let toks = all.filter((w) => /\d/.test(w) || MODEL_WORDS.has(w)).slice(0, 7);
  if (toks.filter((w) => /\d/.test(w)).length === 0) toks = all.slice(0, 6);
  const cond = condition(o.title);
  return `t:${brand}:${toks.sort().join('-')}:${s.storageGb ?? ''}:${s.ramGb ?? ''}${cond === 'new' ? '' : `:${cond}`}`;
}

/** Token-set similarity (0..1) of two titles, used to merge near-identical keys inside a brand block. */
export function similarity(a: string, b: string): number {
  const A = new Set(parseSpecs(a).tokens), B = new Set(parseSpecs(b).tokens);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / Math.min(A.size, B.size);
}

// Rule-based categorisation over the normalised title + breadcrumbs. Order matters (specific first).
const RULES: [string, RegExp][] = [
  ['accessories', /\b(bag|backpack|laptop bag|deskmat|mouse ?pad|touch screen pen|stylus pen|case|cover|screen protector|glass protector|tempered|strap|band for|holder|stand|cable|adapter|charger|charging|power ?bank|hub|dock|sleeve|pouch|skin|stylus|pen tip|lanyard|grip|mount|tripod|selfie|memory card|micro ?sd|sd card|flash ?drive|usb drive|otg)\b|جراب|اسكرينه|حمايه|شاحن|كابل|باور بانك|حامل|استاند|كفر/],
  ['personal-care', /\b(shaver|trimmer|epilator|hair ?dryer|straightener|curler|toothbrush|grooming|clipper|scale)\b|ماكينه حلاقه|مجفف شعر|فرشاه اسنان|مكواه شعر/],
  ['kitchen', /\b(blender|mixer|kettle|toaster|air ?fryer|fryer|microwave|oven|coffee|espresso|juicer|food processor|grill|chopper|cooker|hand mixer|sandwich|rice cooker|dishwasher|hood|hob)\b|خلاط|كاتل|غلايه|ميكروويف|قلايه|ماكينه قهوه|فرن|بوتاجاز|غساله اطباق|شفاط/],
  ['appliances', /\b(washing machine|washer|dryer|refrigerator|fridge|freezer|air conditioner|split ac|vacuum|iron|steam|water dispenser|heater|fan|cooler|purifier|deep freezer)\b|غساله|ثلاجه|ديب فريزر|تكييف|مكنسه|مكواه|سخان|مروحه|كولدير|مبرد/],
  ['gaming', /\b(playstation|ps5|ps4|xbox|nintendo|switch oled|gaming controller|dualsense|joystick|gamepad|game disc|steam deck|rog ally)\b|بلايستيشن|دراع/],
  ['tablets', /\b(ipad|tablet|galaxy tab|matepad|redmi pad|xiaomi pad|tab s\d|tab a\d)\b|تابلت/],
  ['laptops', /\b(laptop|notebook|macbook|chromebook|thinkpad|ideapad|vivobook|zenbook|pavilion|inspiron|aspire|nitro|legion|tuf gaming|victus|omen|latitude|vostro|elitebook|probook)\b|لابتوب/],
  ['lifestyle', /\b(smart ?watch|smartwatch|watch \d|watch ultra|watch se|galaxy watch|fit \d|band \d|fitness tracker|amazfit|smart band|smart ring)\b|ساعه ذكيه/],
  ['audio', /\b(earbuds|earphones?|headphones?|headset|airpods|buds|speaker|soundbar|sound bar|subwoofer|microphone|mic|neckband|tws|freebuds|soundcore)\b|سماعه|سماعات|مكبر صوت|ساوند بار/],
  ['cameras', /\b(camera|dslr|mirrorless|gopro|action cam|lens|instax|webcam|dashcam|dash cam|gimbal|drone)\b|كاميرا/],
  ['networking', /\b(router|access point|mesh|range extender|repeater|switch \d+ port|network switch|modem|wifi extender|lan card)\b|راوتر/],
  ['smart-home', /\b(smart plug|smart bulb|smart lamp|security camera|ip camera|doorbell|smart lock|alexa|echo dot|google home|nest)\b/],
  ['tvs', /\b(tv|television|monitor|smart screen|qled|oled|uhd|4k screen|projector)\b|شاشه|تلفزيون|تليفزيون|بروجيكتور/],
  ['computing', /\b(ssd|hdd|hard drive|hard disk|ram|ram ddr|ddr4|ddr5|graphics card|gpu|rtx|radeon|motherboard|processor|cpu|ryzen|core i\d|power supply|psu|pc case|cooler master|keyboard|mouse|printer|ink|toner|scanner|desktop|all in one|mini pc|ups)\b|كيبورد|ماوس|طابعه|هارد/],
  ['phones', /\b(iphone|galaxy [asmz]\d|galaxy note|smartphone|mobile phone|redmi note|redmi \d|poco [a-z]\d|pixel \d|reno\d*|realme \d|honor \d|honor x\d|nova \d|infinix (hot|note|smart|zero)|tecno (spark|camon|pova|phantom)|nokia [cg]\d|oneplus|nothing phone|xiaomi \d+|\d+t pro)\b|موبايل|تليفون|هاتف/],
];

export function categorize(title: string, crumbs: string[] = [], productType?: string | null): string | null {
  const hint = normAr(`${productType ?? ''} ${crumbs.join(' ')}`);
  const t = normAr(title);
  // Breadcrumbs/product type are the store's own taxonomy: trust them first, then the title.
  for (const src of [hint, `${t} ${hint}`]) {
    if (!src.trim()) continue;
    for (const [slug, re] of RULES) if (re.test(src)) return slug;
  }
  return null;
}

// ---------------- extraction ----------------
export interface Extracted {
  title: string; brand?: string | null; sku?: string | null; gtin?: string | null; mpn?: string | null; image?: string | null;
  price: number | null; listPrice?: number | null; currency?: string | null; inStock?: boolean | null; crumbs: string[];
  rating?: number | null; reviews?: number | null; source: 'jsonld' | 'og' | 'feed' | 'api' | 'user';
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : null;
};
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));

// biome-ignore lint/suspicious/noExplicitAny: schema.org JSON is free-form.
type J = any;
function* walk(node: J): Generator<J> {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) { for (const n of node) yield* walk(n); return; }
  yield node;
  if (node['@graph']) yield* walk(node['@graph']);
  if (node.mainEntity) yield* walk(node.mainEntity);
  if (node.hasVariant) yield* walk(node.hasVariant);
}
const isType = (n: J, t: string) => { const v = n?.['@type']; return Array.isArray(v) ? v.includes(t) : v === t; };
const first = (v: J) => (Array.isArray(v) ? v[0] : v);

export function extractProduct(html: string): Extracted | null {
  const blocks = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
  let product: J = null; const crumbs: string[] = [];
  for (const raw of blocks) {
    let data: J;
    try { data = JSON.parse(raw.trim().replace(/[\u0000-\u001f]+/g, ' ')); } catch { continue; }
    for (const n of walk(data)) {
      if (!product && (isType(n, 'Product') || isType(n, 'ProductGroup')) && n.name) product = n;
      if (isType(n, 'BreadcrumbList') && Array.isArray(n.itemListElement) && !crumbs.length) {
        for (const it of n.itemListElement) { const name = it?.name ?? it?.item?.name; if (name) crumbs.push(decode(String(name))); }
      }
    }
  }
  const meta = (p: string) => decode(html.match(new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${p}["'][^>]*content=["']([^"']*)["']`, 'i'))?.[1] ?? html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name|itemprop)=["']${p}["']`, 'i'))?.[1] ?? '') || null;
  if (product) {
    const offersRaw = product.offers ?? first(product.hasVariant)?.offers;
    const offers: J[] = Array.isArray(offersRaw) ? offersRaw : offersRaw ? [offersRaw] : [];
    let price: number | null = null; let currency: string | null = null; let inStock: boolean | null = null; let listPrice: number | null = null;
    for (const o of offers) {
      const p = num(o.price ?? o.lowPrice ?? o.priceSpecification?.price ?? first(o.priceSpecification)?.price);
      if (p && (price == null || p < price)) { price = p; currency = o.priceCurrency ?? o.priceSpecification?.priceCurrency ?? currency; }
      const av = String(o.availability ?? '');
      if (av) inStock = inStock || /InStock|LimitedAvailability|OnlineOnly|PreOrder/i.test(av);
      const hp = num(o.highPrice);
      if (hp && price && hp > price) listPrice = hp;
    }
    const brand = typeof product.brand === 'string' ? product.brand : first(product.brand)?.name ?? null;
    const img = first(product.image);
    const agg = product.aggregateRating;
    return {
      title: decode(String(product.name)).trim(), brand: brand ? decode(String(brand)) : null, sku: product.sku ? String(product.sku) : null,
      gtin: String(product.gtin13 ?? product.gtin ?? product.gtin12 ?? product.gtin14 ?? product.gtin8 ?? '') || null, mpn: product.mpn ? String(product.mpn) : null,
      image: typeof img === 'string' ? img : img?.url ?? img?.contentUrl ?? meta('og:image'), price: price ?? num(meta('product:price:amount')), listPrice,
      currency: currency ?? meta('product:price:currency'), inStock, crumbs, rating: num(agg?.ratingValue), reviews: num(agg?.reviewCount ?? agg?.ratingCount), source: 'jsonld',
    };
  }
  const ogTitle = meta('og:title');
  const ogPrice = num(meta('product:price:amount') ?? meta('og:price:amount'));
  if (ogTitle && ogPrice) {
    const av = meta('product:availability') ?? meta('og:availability') ?? '';
    return { title: ogTitle, image: meta('og:image'), price: ogPrice, currency: meta('product:price:currency') ?? meta('og:price:currency'), inStock: av ? /in ?stock|instock/i.test(av) : null, crumbs, brand: meta('product:brand'), source: 'og' };
  }
  return null;
}

/** EGP sanity: drop obviously wrong prices (installment amounts, cents, placeholders). */
export function plausibleEgp(price: number | null | undefined, category?: string | null): boolean {
  if (!price || !Number.isFinite(price)) return false;
  const min = category === 'accessories' ? 20 : category === 'phones' || category === 'laptops' || category === 'tvs' ? 1500 : 50;
  return price >= min && price <= 1_500_000;
}

export const productId = async (key: string): Promise<string> => {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(key));
  return 'p' + Array.from(new Uint8Array(d).slice(0, 10), (b) => b.toString(16).padStart(2, '0')).join('');
};
export const offerId = async (url: string): Promise<string> => {
  const d = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(url));
  return 'o' + Array.from(new Uint8Array(d).slice(0, 10), (b) => b.toString(16).padStart(2, '0')).join('');
};

/** Strip tracking params so the same product URL dedupes. */
export function canonicalUrl(u: string): string {
  try {
    const url = new URL(u);
    url.hash = '';
    for (const k of [...url.searchParams.keys()]) if (/^(utm_|gclid|fbclid|ref|tag|psc|th|smid|spm|variant$)/i.test(k)) url.searchParams.delete(k);
    url.hostname = url.hostname.toLowerCase();
    return url.toString().replace(/\?$/, '');
  } catch { return u; }
}

// ---------------- deal intelligence ----------------
export interface Point { at: string; price: number }
/** Heat (Pepper-style temperature seeded by real price data) with a 36 h half-life on votes. */
export function heat(o: { hot: number; cold: number; dropPct?: number | null; vsMedian?: number | null; atLow?: boolean; ageHours?: number }): number {
  const votes = (o.hot - o.cold) * 12;
  const price = Math.max(0, o.dropPct ?? 0) * 3 + Math.max(0, o.vsMedian ?? 0) * 2 + (o.atLow ? 40 : 0);
  const decay = Math.pow(0.5, (o.ageHours ?? 0) / 36);
  return Math.round((votes + price) * decay);
}
/**
 * Full heat used for ranking: community votes + real price signals, plus small bonuses for the store's own sale and
 * for being cheapest across several stores. Price signals are weighted by how much money is at stake, so a 5% drop
 * on a laptop outranks the same % on a cable when nobody has voted yet.
 */
export function rowHeat(o: { hot: number; cold: number; dropPct?: number | null; vsMedian?: number | null; atLow?: boolean; ageHours?: number; claimed?: number; liveStores?: number; price?: number | null }): number {
  const w = Math.min(1.2, Math.max(0.5, Math.log10(Math.max(10, o.price ?? 10000)) / 4.3));
  const signals = heat({ hot: 0, cold: 0, dropPct: o.dropPct, vsMedian: o.vsMedian, atLow: o.atLow, ageHours: o.ageHours });
  const bonus = Math.min(15, (o.claimed ?? 0) * 0.4) + Math.min(10, Math.max(0, (o.liveStores ?? 1) - 1) * 4);
  return Math.max(0, Math.round((o.hot - o.cold) * 12 + (signals + bonus) * w));
}

export interface Prediction { verdict: 'buy' | 'wait' | 'fair' | 'unknown'; confidence: number; reasonAr: string; reasonEn: string; low90?: number; median?: number; trend?: number }
/** Transparent, history-only estimate. Never presented as a guarantee. */
export function predict(points: Point[], current: number | null): Prediction {
  const ps = points.filter((p) => p.price > 0).sort((a, b) => a.at.localeCompare(b.at));
  if (!current || ps.length < 3) return { verdict: 'unknown', confidence: 0, reasonAr: 'لسه بنجمع تاريخ السعر — ارجع بعد كام يوم', reasonEn: 'Still collecting price history' };
  const since = Date.now() - 90 * 86400_000;
  const recent = ps.filter((p) => Date.parse(p.at) >= since);
  const vals = (recent.length >= 3 ? recent : ps).map((p) => p.price).sort((a, b) => a - b);
  const low = vals[0]!, high = vals[vals.length - 1]!, median = vals[Math.floor(vals.length / 2)]!;
  const pos = high > low ? (current - low) / (high - low) : 0.5;
  const last = ps.slice(-6).map((p) => p.price);
  const trend = last.length > 1 ? (last[last.length - 1]! - last[0]!) / last[0]! : 0;
  const days = (Date.now() - Date.parse(ps[0]!.at)) / 86400_000;
  const conf = Math.min(0.9, 0.3 + Math.min(days, 90) / 150 + Math.min(ps.length, 30) / 100);
  if (current <= low * 1.01) return { verdict: 'buy', confidence: conf, reasonAr: 'أقل سعر شفناه في آخر ٩٠ يوم', reasonEn: 'Lowest price we have seen in 90 days', low90: low, median, trend };
  if (pos <= 0.25 && current < median) return { verdict: 'buy', confidence: conf * 0.9, reasonAr: `قريب من القاع وأقل من المتوسط (${Math.round(median)} ج.م)`, reasonEn: 'Near the low and below the median', low90: low, median, trend };
  if (trend < -0.03) return { verdict: 'wait', confidence: conf * 0.7, reasonAr: 'السعر بينزل الأيام دي — ممكن ينزل كمان', reasonEn: 'Price is trending down; may drop further', low90: low, median, trend };
  if (pos >= 0.7) return { verdict: 'wait', confidence: conf * 0.8, reasonAr: `أعلى من المعتاد — نزل قبل كده لـ ${Math.round(low)} ج.م`, reasonEn: 'Above usual; it has been lower', low90: low, median, trend };
  return { verdict: 'fair', confidence: conf * 0.8, reasonAr: 'سعر عادي مقارنة بتاريخه', reasonEn: 'A typical price for this product', low90: low, median, trend };
}
