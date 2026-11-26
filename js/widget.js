/*!
 * STRATA · Pre-check widget (single bundled file, vanilla JS, no dependencies)
 *
 * Load once, at the end of <body>, after the page markup:
 *   <script src="js/precheck.js" defer></script>
 *
 * Sections
 *   1. CONFIG          weights, tiers, keyword lists, brand list, thresholds
 *   2. Text helpers    normalisation, fuzzy matching
 *   3. Scoring         pure functions, no DOM (works in Node for unit tests)
 *   4. Image analysis  canvas: resolution, sharpness, exposure, duplicate hash
 *   5. Blueprint       layered SVG car
 *   6. UI              form, photo slots, states, result
 *
 * Node / console testing of the scoring only:
 *   const { evaluate, CONFIG } = require('./precheck.js');   // Node
 *   PreCheck.evaluate({...})                                  // browser console
 */
(function (root) {
  'use strict';

  /* =====================================================================
   * 1. CONFIG
   * Everything tunable lives here. Thresholds for photo analysis are
   * starting values: calibrate them with 10-20 real photos.
   * ===================================================================== */

  // Brand helper: models = [[bonus, 'key', 'key'], ...]
  // A model matches when the user's model text contains a key (spaces and
  // punctuation ignored). The highest matching bonus wins.
  const brand = (name, aliases, prestige, models) => ({
    name,
    aliases,
    prestige,
    models: models.map((m) => ({ bonus: m[0], keys: m.slice(1) })),
  });

  const CONFIG = {
    weights: { vehicle: 0.35, story: 0.25, presentation: 0.3, completeness: 0.1 },
    clamp: { min: 5, max: 98 }, // never 0, never 100: no outcome is promised

    year: { min: 1886, futureYears: 1 },

    vehicle: {
      ageWeight: 0.5,
      identityWeight: 0.5,
      // Sorted from oldest to newest. First band the car's age reaches wins.
      ageBands: [
        { minAge: 40, score: 95 },
        { minAge: 30, score: 88 },
        { minAge: 20, score: 75 },
        { minAge: 15, score: 65 },
        { minAge: 8, score: 52 },
        { minAge: 0, score: 42 },
      ],
      identityBase: 50, // unknown cars are neutral, never punished
      knownBrandBonus: 8,
      fuzzyBrandBonus: 5,
    },

    story: {
      minDescription: 15,
      categoryCap: 3, // only the best 3 categories count
      pointsPerCategory: 30,
      depthBonus: 5, // 2+ different keywords in one category
      lengthBonus: [
        { min: 80, points: 10 },
        { min: 40, points: 5 },
      ],
      // Keyword syntax: plain phrase = whole words; "stem*" = word prefix;
      // "one of #" = phrase followed by a number.
      categories: {
        originality: {
          sample: 'matching numbers original paint',
          keywords: [
            'matching numbers', 'numbers matching', 'unrestored', 'original paint',
            'original interior', 'original engine', 'original condition', 'all original',
            'factory original', 'patina', 'survivor', 'barn find', 'untouched',
            'never restored', 'time capsule', 'period correct',
          ],
        },
        craft: {
          sample: 'frame off restoration hand built',
          keywords: [
            'frame off', 'hand built', 'handbuilt', 'hand made', 'handmade', 'handcraft*',
            'bespoke', 'fabricated', 'custom built', 'coachbuilt', 'coach built', 'restor*',
            'rebuil*', 'restomod', 'ground up', 'nut and bolt', 'meticulous*', 'craft*',
          ],
        },
        rarity: {
          sample: 'limited edition one of 200',
          keywords: [
            'limited', 'numbered', 'homologation', 'homologated', 'prototype', 'one of #',
            'one off', 'oneoff', 'special edition', 'low production', 'low volume',
            'factory race', 'works car', 'rare', 'rarest', 'unique',
          ],
        },
        provenance: {
          sample: 'first owner documented history',
          keywords: [
            'first owner', 'one owner', 'single owner', 'two owners', 'ownership',
            'history', 'document*', 'provenance', 'service history', 'family owned',
            'family since', 'delivered new', 'chassis number', 'certificate', 'archive',
            'raced', 'race history', 'competition history', 'invoice',
          ],
        },
      },
      // Zero value. Used only to coach people towards specifics.
      fluff: [
        'fast', 'awesome', 'best', 'cool', 'amazing', 'beast', 'sick', 'insane', 'super',
        'nice', 'great', 'love', 'perfect', 'beautiful', 'gorgeous', 'stunning', 'epic',
      ],
    },

    photos: {
      required: ['front', 'rear', 'side', 'interior', 'detail'],
      optional: ['engine', 'documents', 'closeup'],
      names: {
        front: 'Front \u00be',
        rear: 'Rear \u00be',
        side: 'Side profile',
        interior: 'Interior',
        detail: 'Detail',
        engine: 'Engine bay',
        documents: 'Documents',
        closeup: 'Close-up',
      },
      types: ['image/jpeg', 'image/png', 'image/webp'],
      maxBytes: 10 * 1024 * 1024,

      analysisLongSide: 480, // px, canvas used for measuring
      resolution: { zeroShortSide: 400, fullShortSide: 1200 },
      sharpness: { low: 20, high: 300, tiles: 6, percentile: 0.8 },
      exposure: { idealMin: 90, idealMax: 170, falloff: 80, clipHighOk: 0.03, clipLowOk: 0.25 },
      partWeights: { res: 0.3, sharp: 0.4, exposure: 0.3 },

      duplicateMaxDistance: 6, // dHash bits (of 64) below which photos count as the same
      coverageFloor: 0.5, // presentation = quality * (floor + (1-floor) * coverage)
      optionalBonus: [3, 2, 1], // diminishing returns
      optionalMinQuality: 50,

      // Used to estimate the value of "add a photo" / "fix this photo" tips.
      synthetic: { shortSide: 2000, sharpness: 200, mean: 125, clipHigh: 0, clipLow: 0, hash: null },
    },

    qualityGate: { threshold: 50, cap: 60 }, // poor photos cap the total

    completeness: {
      fields: 30,
      requiredPhotos: 30,
      descriptionLength: 20,
      descriptionFullAt: 120,
      optionalPhotos: 20,
    },

    tiers: [
      { min: 0, label: 'Foundations', message: 'Add more detail and we will see more. Photos and story carry the most weight.' },
      { min: 30, label: 'Taking shape', message: 'A good start. A few layers of your build are still missing.' },
      { min: 60, label: 'Strong candidate', message: 'Worth applying. The curators will want a closer look.' },
      { min: 80, label: 'Exceptional', message: 'A very strong start. Tell the whole story in your application.' },
    ],

    messages: {
      capped: 'Photo quality is currently holding your score back.',
      unreadable: 'We could not read this image. Please try another file.',
      badType: 'Please choose a JPG, PNG or WebP image.',
      tooBig: 'This file is larger than 10 MB.',
    },

    tips: {
      max: 3,
      partThreshold: 55,
      story: {
        originality: 'Mention what is original: matching numbers, original paint or patina.',
        craft: 'Describe the craftsmanship: a frame-off restoration, hand-built or bespoke work.',
        rarity: 'Say what makes it rare: limited production, a numbered car or a homologation special.',
        provenance: 'Add provenance: first owner, documented history or a racing past.',
      },
      length: 'Use more of the 150 characters. Concrete details help the curators.',
      fluff: 'Swap generic words like \u201c{word}\u201d for specifics a curator can verify.',
      vehicle: 'A newer car is judged on its story. Mention provenance, rarity or craftsmanship.',
      sharp: 'Your {slot} photo looks soft. Retake it in good light and hold the camera steady.',
      dark: 'Your {slot} photo is too dark. Try open shade or soft daylight.',
      bright: 'Your {slot} photo is too bright, with blown highlights. Avoid harsh midday sun.',
      res: 'Your {slot} photo is low resolution ({px} px on the short side). Send the original file, not a compressed copy.',
      duplicate: 'Your {slot} and {other} photos look almost identical. Show a different angle.',
      optional: {
        engine: 'Add an engine bay photo.',
        documents: 'Add a photo of documents or history.',
        closeup: 'Add a close-up of a detail you are proud of.',
      },
      none: 'No obvious gaps. Save the rest of the story for your application.',
    },

    ui: {
      minAnalysisMs: 1600,
      countUpMs: 1400,
      storageKey: 'strata:precheck', // read this on participate.html
      defaultLabel: 'Review my build',
      againLabel: 'Review again',
      busyLabel: 'Reviewing\u2026',
    },

    // Starter list: extend freely. Unknown brands and models are neutral.
    brands: [
      brand('Porsche', ['porsche'], 15, [
        [42, '917', '959', '550'], [38, 'carrera rs', 'gt1'], [32, '356', 'speedster'],
        [26, 'gt3 rs', 'gt2 rs', 'carrera gt'], [20, '930', '964', '993', 'turbo'],
        [18, '911'], [10, '914', '924', '928', '944', '968', 'boxster', 'cayman'],
      ]),
      brand('BMW', ['bmw'], 8, [
        [45, '3.0 csl', 'csl', 'm1', 'z8'], [30, '2002', 'e9', 'isetta', '507'],
        [24, 'm3', 'e30'], [18, 'm5', 'e28', 'e34', 'z1'], [10, 'e21', 'e36', 'e46'],
      ]),
      brand('Mercedes-Benz', ['mercedes', 'mercedes benz', 'benz'], 10, [
        [48, '300 sl', 'gullwing', 'w196'], [32, 'pagoda', '230 sl', '250 sl', '280 sl', '500 e'],
        [26, 'evo ii', 'evolution'], [20, '280 se', 'w111', 'w108'],
        [15, '190 e', 'w124', 'g wagen', 'g class', 'amg', '500 sl', '560 sl', 'w123'],
      ]),
      brand('Ferrari', ['ferrari'], 22, [
        [50, '250 gto', '275 gtb', 'dino', '288 gto', 'f40', 'f50', 'enzo', 'daytona'],
        [35, 'testarossa', '512', '365', '308', '328', '348', '355', '250', '275'],
        [25, 'california', 'mondial', '456', '550', '575', '360', '430'],
      ]),
      brand('Lamborghini', ['lamborghini', 'lambo'], 22, [
        [48, 'miura', 'countach', '350 gt', '400 gt'],
        [35, 'diablo', 'espada', 'urraco', 'islero', 'jalpa', 'murcielago'],
        [22, 'gallardo', 'huracan', 'aventador'],
      ]),
      brand('Alfa Romeo', ['alfa romeo', 'alfa'], 12, [
        [52, '33 stradale', '8c'], [34, 'montreal', 'tz', 'gta', 'duetto'],
        [22, 'giulia', 'gtv', 'spider', 'alfetta', 'sz', 'rz'],
      ]),
      brand('Lancia', ['lancia'], 14, [
        [52, 'stratos', '037', 'delta s4'],
        [36, 'integrale', 'fulvia', 'aurelia', 'flaminia'],
        [20, 'beta', 'gamma', 'montecarlo'],
      ]),
      brand('Jaguar', ['jaguar'], 10, [
        [50, 'd type', 'c type', 'xj220', 'xkss'],
        [36, 'e type', 'xk120', 'xk140', 'xk150', 'mark 2', 'mk2'],
        [20, 'xj6', 'xjs', 'xj12', 's type', 'xk8'],
      ]),
      brand('Aston Martin', ['aston martin', 'aston'], 20, [
        [48, 'db5', 'one 77', 'vulcan', 'lagonda'],
        [34, 'db4', 'db6', 'db2', 'virage', 'zagato'],
        [18, 'db7', 'db9', 'vanquish', 'vantage'],
      ]),
      brand('Maserati', ['maserati'], 14, [
        [40, 'bora', 'ghibli', 'merak', 'khamsin', 'indy', 'mistral', '3500 gt', 'mc12'],
        [18, 'quattroporte', 'biturbo', 'granturismo'],
      ]),
      brand('Bugatti', ['bugatti'], 28, [[55, 'type 57', 'type 35', 'royale', 'eb110'], [30, 'veyron', 'chiron']]),
      brand('Lotus', ['lotus'], 16, [
        [45, 'esprit s1', 'elite', 'eleven', 'super seven', 'seven', 'type 49'],
        [32, 'elan', 'europa', 'esprit', 'elise s1', 'exige'],
        [20, 'evora', 'elise', 'carlton', 'omega', 'excel', 'eclat'],
      ]),
      brand('Volkswagen', ['volkswagen', 'vw'], 5, [
        [28, 'karmann ghia', 'samba', 't1', 'type 2', 'kubelwagen', 'thing'],
        [20, 'beetle', 'kafer', 'golf gti', 'mk1', 'corrado', 'scirocco', 'iltis', 'syncro'],
        [12, 'golf r32', 'golf r', 'mk2', 'polo g40', 'g60'],
      ]),
      brand('Audi', ['audi'], 8, [
        [50, 'sport quattro', 'ur quattro'], [36, 'quattro', 'rs2'],
        [22, 'rs4', 'rs6', 'r8', 's2', 'v8 quattro'],
      ]),
      brand('Volvo', ['volvo'], 6, [
        [34, 'p1800', 'pv444', 'pv544'], [26, 'amazon', '122s', '121'],
        [18, '240', '740', '850', '142', '144', '164'],
      ]),
      brand('Nissan / Datsun', ['nissan', 'datsun'], 8, [
        [50, 'r34'], [38, '240z', '260z', 'fairlady', 's30', 'r32', 'r33', 'skyline gt r'],
        [32, 'figaro', 'pao', 'be 1', 's cargo'],
        [28, 'skyline', 'silvia', 's13', 's14', 's15', '180sx'], [20, 'gt r', '300zx', 'z32'],
      ]),
      brand('Toyota', ['toyota'], 8, [
        [55, '2000gt'],
        [35, 'sports 800', 'ae86', 'trueno', 'levin', 'celica gt four', 'st185', 'st205', 'fj40'],
        [22, 'supra', 'celica', 'mr2', 'soarer', 'crown', 'hilux', 'land cruiser'],
      ]),
      brand('Honda', ['honda'], 8, [
        [38, 'nsx', 's600', 's800', 'beat', 's660', 'ek9', 'dc2', 'integra type r'],
        [24, 's2000', 'crx', 'prelude'], [14, 'civic', 'integra', 'accord', 'type r'],
      ]),
      brand('Mazda', ['mazda'], 8, [
        [55, '787b', 'cosmo'], [36, 'rx7', 'rx 7', 'rx3', 'savanna', 'r100', 'miata'],
        [22, 'mx5', 'rx8', 'eunos'],
      ]),
      brand('Mitsubishi', ['mitsubishi'], 8, [
        [38, 'lancer evolution', 'evo', 'starion', '3000gt', 'gto'],
        [24, 'galant vr 4', 'eclipse', 'delica', 'pajero', 'lancer'],
      ]),
      brand('Subaru', ['subaru'], 6, [
        [55, '22b'], [34, 'sti', '360', 'svx', 'gc8', 'p1'], [18, 'impreza', 'wrx', 'brz', 'legacy', 'brat'],
      ]),
      brand('Ford', ['ford'], 6, [
        [55, 'gt40', 'rs200', 'rs500'],
        [36, 'cosworth', 'rs2000', 'boss 302', 'shelby', 'gt350', 'gt500', 'cobra', 'model a', 'model t', 'thunderbird'],
        [20, 'mustang', 'capri', 'sierra', 'escort', 'xr2', 'xr3', 'granada', 'anglia', 'bronco', 'fairlane', 'galaxie'],
      ]),
      brand('Chevrolet', ['chevrolet', 'chevy'], 6, [
        [40, 'sting ray', 'stingray', 'l88', 'zl1', 'yenko', 'z28', 'bel air', 'nomad'],
        [22, 'corvette', 'camaro', 'impala', 'el camino', 'chevelle', 'nova'],
      ]),
      brand('Dodge / Plymouth', ['dodge', 'plymouth'], 6, [
        [48, 'superbird', 'hemi cuda', 'road runner', 'barracuda'],
        [34, 'charger', 'challenger', 'viper', 'coronet', 'dart'],
      ]),
      brand('Pontiac', ['pontiac'], 6, [[40, 'gto', 'trans am', 'firebird'], [20, 'fiero', 'grand prix']]),
      brand('Citro\u00ebn', ['citroen'], 8, [
        [38, 'ds', 'sm', 'traction avant', '2cv', 'mehari', 'dyane', 'ami'], [22, 'cx', 'gs', 'bx', 'visa', 'hy'],
      ]),
      brand('Renault', ['renault'], 6, [
        [45, 'a110', '5 turbo', 'gordini', 'sport spider', 'clio williams', '4cv'],
        [24, 'alpine', 'fuego', 'twingo', 'r4', '4l', 'r5', 'r16'],
      ]),
      brand('Alpine', ['alpine'], 14, [[40, 'a110', 'a310', 'a610']]),
      brand('Fiat / Abarth', ['fiat', 'abarth'], 8, [
        [45, 'abarth 1000', 'dino'],
        [34, '124 spider', '850 spider', '850 coupe', 'giardiniera', 'x1 9', 'barchetta', 'abarth'],
        [18, '500', '124', '126', '127', '128', '131', 'ritmo'],
      ]),
      brand('Mini / Austin', ['mini', 'austin'], 8, [
        [36, 'cooper s', '1275 gt', 'clubman', 'moke', 'john cooper'], [20, 'cooper', 'mk1', 'mk2'],
      ]),
      brand('MG', ['mg'], 8, [[34, 'mga', 'mgb', 'mgc', 'midget', 'magnette', '6r4', 'rv8'], [20, 'tc', 'td', 'tf']]),
      brand('Austin-Healey', ['austin healey', 'healey'], 12, [[42, '3000', '100 s', 'frogeye', 'bugeye'], [30, 'sprite']]),
      brand('Triumph', ['triumph'], 8, [
        [34, 'tr3', 'tr4', 'tr5', 'tr6', 'stag', 'spitfire', 'gt6'], [20, 'herald', 'dolomite', 'tr7', 'tr8'],
      ]),
      brand('Land Rover', ['land rover', 'landrover', 'rover'], 8, [
        [34, 'series 1', 'series i', 'series 2', 'series iia', 'series iii', 'range rover classic', 'p5', 'p6', 'sd1'],
        [24, 'defender 90', 'defender 110', 'defender 130'], [18, 'defender', 'range rover', 'discovery'],
      ]),
      brand('Opel', ['opel', 'vauxhall'], 6, [
        [38, 'manta 400', 'ascona 400', 'speedster', 'commodore gs'],
        [22, 'manta', 'kadett', 'calibra', 'monza', 'senator', 'rekord', 'commodore'],
      ]),
      brand('NSU', ['nsu'], 10, [[40, 'ro 80', 'ro80', 'wankel', 'tts', 'prinz', 'spider']]),
      brand('DKW / Auto Union', ['dkw', 'auto union'], 10, [[38, 'f102', 'monza', 'junior', 'munga', 'sonderklasse']]),
      brand('Borgward', ['borgward'], 10, [[40, 'isabella', 'p100', 'hansa']]),
      brand('Trabant', ['trabant'], 4, [[30, '601', 'p50', 'p60', 'kubel', 'tramp', 'universal']]),
      brand('Wartburg', ['wartburg'], 4, [[30, '353', '311', '312']]),
    ],

    // SVG layers (blueprint) are unlocked by data-from in the markup.
    blueprint: { drawMs: 700, ghostNext: 0.55, ghostLater: 0.14 },
  };

  /* =====================================================================
   * 2. TEXT HELPERS
   * ===================================================================== */

  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

  function normalizeText(s) {
    return String(s == null ? '' : s)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[-_/]+/g, ' ')
      .replace(/[^a-z0-9\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Year field: digits only, max 4. */
  function formatYearField(field) {
    const cleaned = field.value.replace(/\D/g, '').slice(0, 4);
    if (field.value !== cleaned) field.value = cleaned;
  }

  const compact = (s) => normalizeText(s).replace(/\s+/g, '');

  function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
    for (let i = 1; i <= a.length; i++) {
      const cur = [i];
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      prev = cur;
    }
    return prev[b.length];
  }

  function hamming(a, b) {
    let d = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) d++;
    return d + Math.abs(a.length - b.length);
  }

  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // "restor*" -> word prefix. "one of #" -> phrase followed by a number.
  function keywordRegex(kw) {
    const stem = kw.endsWith('*');
    const parts = kw.replace(/\*$/, '').split('#').map((p) => escapeRe(normalizeText(p)));
    return new RegExp('(?:^|\\s)' + parts.join(' \\d+') + (stem ? '' : '(?=\\s|$)'));
  }

  const regexCache = new Map();
  function matchesKeyword(text, kw) {
    let re = regexCache.get(kw);
    if (!re) {
      re = keywordRegex(kw);
      regexCache.set(kw, re);
    }
    return re.test(text);
  }

  /* =====================================================================
   * 3. SCORING (pure: no DOM, no globals except CONFIG)
   * ===================================================================== */

  const isValidYear = (y, currentYear, cfg) =>
    Number.isInteger(y) && y >= cfg.year.min && y <= currentYear + cfg.year.futureYears;

  function matchBrand(input, cfg) {
    const q = normalizeText(input);
    if (!q) return null;
    let best = null;
    for (const b of cfg.brands) {
      for (const alias of b.aliases) {
        const a = normalizeText(alias);
        const d = a === q ? 0 : levenshtein(a, q);
        if (d === 0) return { brand: b, distance: 0 };
        if (!best || d < best.distance) best = { brand: b, distance: d };
      }
    }
    const max = q.length <= 3 ? 0 : q.length <= 5 ? 1 : q.length <= 10 ? 2 : 3;
    return best && best.distance <= max ? best : null;
  }

  function matchModel(b, model) {
    const m = compact(model);
    let bonus = 0;
    let key = null;
    for (const entry of b.models) {
      for (const k of entry.keys) {
        const ck = compact(k);
        if (ck && m.includes(ck) && entry.bonus > bonus) {
          bonus = entry.bonus;
          key = k;
        }
      }
    }
    return { bonus, key };
  }

  function scoreVehicle(input, cfg) {
    const v = cfg.vehicle;
    const age = Math.max(0, input.currentYear - input.year);
    const band = v.ageBands.find((x) => age >= x.minAge) || v.ageBands[v.ageBands.length - 1];

    const match = matchBrand(input.brand, cfg);
    let identity = v.identityBase;
    let notable = null;
    if (match) {
      identity += match.distance === 0 ? v.knownBrandBonus : v.fuzzyBrandBonus;
      identity += match.brand.prestige;
      notable = matchModel(match.brand, input.model);
      identity += notable.bonus;
    }
    identity = clamp(identity, 0, 100);

    return {
      score: clamp(v.ageWeight * band.score + v.identityWeight * identity, 0, 100),
      age,
      ageScore: band.score,
      identity,
      brand: match ? match.brand.name : null,
      model: notable && notable.key ? notable.key : null,
    };
  }

  function scoreStory(description, cfg) {
    const s = cfg.story;
    const text = normalizeText(description);
    const len = String(description || '').trim().length;

    const categories = {};
    for (const [name, cat] of Object.entries(s.categories)) {
      categories[name] = cat.keywords.filter((kw) => matchesKeyword(text, kw));
    }
    const ranked = Object.entries(categories)
      .filter(([, hits]) => hits.length > 0)
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, s.categoryCap);

    let points = 0;
    for (const [, hits] of ranked) points += s.pointsPerCategory + (hits.length > 1 ? s.depthBonus : 0);

    const lengthRule = s.lengthBonus.find((r) => len >= r.min);
    const lengthPoints = lengthRule ? lengthRule.points : 0;

    const fluff = s.fluff.filter((w) => matchesKeyword(text, w));

    return {
      score: clamp(points + lengthPoints, 0, 100),
      categories,
      activeCategories: Object.values(categories).filter((h) => h.length > 0).length,
      length: len,
      lengthPoints,
      fluff,
    };
  }

  function scorePhoto(m, cfg) {
    const p = cfg.photos;
    const res =
      clamp((m.shortSide - p.resolution.zeroShortSide) / (p.resolution.fullShortSide - p.resolution.zeroShortSide), 0, 1) * 100;

    const lnLow = Math.log(p.sharpness.low + 1);
    const lnHigh = Math.log(p.sharpness.high + 1);
    const sharp = clamp((Math.log(m.sharpness + 1) - lnLow) / (lnHigh - lnLow), 0, 1) * 100;

    const e = p.exposure;
    const dist = Math.max(0, e.idealMin - m.mean, m.mean - e.idealMax);
    const clipPenalty = Math.min(
      40,
      Math.max(0, m.clipHigh - e.clipHighOk) * 400 + Math.max(0, m.clipLow - e.clipLowOk) * 100
    );
    const exposure = clamp(100 - clamp(dist / e.falloff, 0, 1) * 100 - clipPenalty, 0, 100);

    const w = p.partWeights;
    return { res, sharp, exposure, quality: res * w.res + sharp * w.sharp + exposure * w.exposure };
  }

  function scorePresentation(photos, cfg) {
    const p = cfg.photos;
    const order = p.required.concat(p.optional);
    const scored = photos
      .map((ph) => Object.assign({ slot: ph.slot, optional: !!ph.optional, metrics: ph.metrics, duplicateOf: null }, scorePhoto(ph.metrics, cfg)))
      .sort((a, b) => order.indexOf(a.slot) - order.indexOf(b.slot));

    // Near-identical photos only count once.
    const seen = [];
    for (const item of scored) {
      if (item.metrics.hash) {
        const twin = seen.find((o) => o.metrics.hash && hamming(o.metrics.hash, item.metrics.hash) <= p.duplicateMaxDistance);
        if (twin) item.duplicateOf = twin.slot;
      }
      seen.push(item);
    }

    const uniqueRequired = scored.filter((x) => !x.optional && !x.duplicateOf);
    const coverage = uniqueRequired.length / p.required.length;
    const avgQuality = mean(uniqueRequired.map((x) => x.quality));

    const extras = scored
      .filter((x) => x.optional && !x.duplicateOf && x.quality >= p.optionalMinQuality)
      .sort((a, b) => b.quality - a.quality);
    const optionalBonus = extras.reduce((sum, _, i) => sum + (p.optionalBonus[i] || 0), 0);

    const score = clamp(avgQuality * (p.coverageFloor + (1 - p.coverageFloor) * coverage) + optionalBonus, 0, 100);
    const gateFailed = uniqueRequired.length > 0 && avgQuality < cfg.qualityGate.threshold;

    return { score, avgQuality, coverage, optionalBonus, gateFailed, photos: scored };
  }

  function scoreCompleteness(input, cfg) {
    const c = cfg.completeness;
    const fieldsOk = [
      String(input.brand || '').trim().length > 0,
      String(input.model || '').trim().length > 0,
      isValidYear(input.year, input.currentYear, cfg),
      String(input.description || '').trim().length >= cfg.story.minDescription,
    ].filter(Boolean).length;

    const photos = input.photos || [];
    const requiredCount = photos.filter((p) => !p.optional).length;
    const optionalCount = photos.filter((p) => p.optional).length;
    const descLen = String(input.description || '').trim().length;

    const score =
      (fieldsOk / 4) * c.fields +
      Math.min(1, requiredCount / cfg.photos.required.length) * c.requiredPhotos +
      Math.min(1, descLen / c.descriptionFullAt) * c.descriptionLength +
      Math.min(1, optionalCount / cfg.photos.optional.length) * c.optionalPhotos;

    return { score: clamp(score, 0, 100) };
  }

  function evaluateCore(input, cfg) {
    const inp = Object.assign({}, input, { currentYear: input.currentYear || new Date().getFullYear() });
    const vehicle = scoreVehicle(inp, cfg);
    const story = scoreStory(inp.description, cfg);
    const presentation = scorePresentation(inp.photos || [], cfg);
    const completeness = scoreCompleteness(inp, cfg);

    const w = cfg.weights;
    const raw =
      vehicle.score * w.vehicle +
      story.score * w.story +
      presentation.score * w.presentation +
      completeness.score * w.completeness;

    const capped = presentation.gateFailed && raw > cfg.qualityGate.cap;
    const exact = clamp(capped ? cfg.qualityGate.cap : raw, cfg.clamp.min, cfg.clamp.max);

    return {
      total: Math.round(exact),
      exact,
      raw,
      capped,
      areas: {
        vehicle: Math.round(vehicle.score),
        story: Math.round(story.score),
        presentation: Math.round(presentation.score),
        completeness: Math.round(completeness.score),
      },
      detail: { vehicle, story, presentation, completeness },
    };
  }

  const tierFor = (total, cfg) => cfg.tiers.filter((t) => total >= t.min).pop() || cfg.tiers[0];

  const cloneInput = (input) =>
    Object.assign({}, input, { photos: (input.photos || []).map((p) => Object.assign({}, p, { metrics: Object.assign({}, p.metrics) })) });

  const fill = (tpl, vars) => tpl.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? vars[k] : ''));

  // Tips carry an estimated gain: the score is re-run with the fix applied.
  function buildTips(input, base, cfg) {
    const t = cfg.tips;
    const names = cfg.photos.names;
    const gainOf = (mutate) => {
      const copy = cloneInput(input);
      mutate(copy);
      return Math.round(evaluateCore(copy, cfg).exact - base.exact);
    };

    const tips = [];
    const { story, presentation, vehicle } = base.detail;

    // Story: up to two missing categories
    if (story.activeCategories < cfg.story.categoryCap) {
      Object.entries(cfg.story.categories)
        .filter(([key]) => story.categories[key].length === 0)
        .map(([key, cat]) => ({
          text: t.story[key],
          gain: gainOf((c) => { c.description = (c.description + ' ' + cat.sample).trim(); }),
        }))
        .sort((a, b) => b.gain - a.gain)
        .slice(0, 2)
        .forEach((x) => tips.push(x));
    }

    // Description length (padding with a non-keyword blob only to estimate the gain)
    const firstLen = cfg.story.lengthBonus[0].min;
    if (story.length < firstLen) {
      tips.push({
        text: t.length,
        gain: gainOf((c) => { c.description = c.description + ' ' + 'x'.repeat(firstLen - story.length); }),
      });
    }

    if (story.fluff.length) tips.push({ text: fill(t.fluff, { word: story.fluff[0] }), gain: null });

    if (vehicle.ageScore < 60 && story.score < 60) tips.push({ text: t.vehicle, gain: null });

    // Photo quality: worst offender per issue type
    const required = presentation.photos.filter((p) => !p.optional && !p.duplicateOf);
    const worst = (part) => required.slice().sort((a, b) => a[part] - b[part])[0];
    const syn = cfg.photos.synthetic;

    const sharpest = worst('sharp');
    if (sharpest && sharpest.sharp < t.partThreshold) {
      tips.push({
        text: fill(t.sharp, { slot: names[sharpest.slot] }),
        gain: gainOf((c) => { c.photos.find((p) => p.slot === sharpest.slot).metrics.sharpness = syn.sharpness; }),
      });
    }
    const exposed = worst('exposure');
    if (exposed && exposed.exposure < t.partThreshold) {
      const dark = exposed.metrics.mean < cfg.photos.exposure.idealMin;
      tips.push({
        text: fill(dark ? t.dark : t.bright, { slot: names[exposed.slot] }),
        gain: gainOf((c) => {
          const m = c.photos.find((p) => p.slot === exposed.slot).metrics;
          m.mean = syn.mean;
          m.clipHigh = 0;
          m.clipLow = 0;
        }),
      });
    }
    const smallest = worst('res');
    if (smallest && smallest.res < t.partThreshold) {
      tips.push({
        text: fill(t.res, { slot: names[smallest.slot], px: smallest.metrics.shortSide }),
        gain: gainOf((c) => { c.photos.find((p) => p.slot === smallest.slot).metrics.shortSide = syn.shortSide; }),
      });
    }

    // Duplicates
    const dup = presentation.photos.find((p) => p.duplicateOf);
    if (dup) {
      tips.push({
        text: fill(t.duplicate, { slot: names[dup.slot], other: names[dup.duplicateOf] }),
        gain: gainOf((c) => { c.photos.find((p) => p.slot === dup.slot).metrics.hash = null; }),
      });
    }

    // Optional evidence photos
    const have = new Set((input.photos || []).map((p) => p.slot));
    cfg.photos.optional
      .filter((slot) => !have.has(slot))
      .forEach((slot) => {
        tips.push({
          text: t.optional[slot],
          gain: gainOf((c) => { c.photos.push({ slot, optional: true, metrics: Object.assign({}, syn) }); }),
        });
      });

    const useful = tips.filter((x) => x.gain === null || x.gain >= 1);
    useful.sort((a, b) => (b.gain == null ? -1 : b.gain) - (a.gain == null ? -1 : a.gain));
    const out = useful.slice(0, t.max);
    return out.length ? out : [{ text: t.none, gain: null }];
  }

  /**
   * input: { brand, model, year:Number, description, photos:[{slot, optional, metrics}], currentYear? }
   * metrics: { shortSide, sharpness, mean, clipHigh, clipLow, hash }
   */
  function evaluate(input, cfg) {
    cfg = cfg || CONFIG;
    const base = evaluateCore(input, cfg);
    return Object.assign({}, base, { tier: tierFor(base.total, cfg), tips: buildTips(input, base, cfg) });
  }

  /* =====================================================================
   * 4. IMAGE ANALYSIS (browser only)
   * ===================================================================== */

  const analysisCache = typeof WeakMap !== 'undefined' ? new WeakMap() : null;

  async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
      try {
        const bmp = await createImageBitmap(file);
        return { source: bmp, width: bmp.width, height: bmp.height, release: () => bmp.close && bmp.close() };
      } catch (e) {
        /* fall back to <img> below */
      }
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { source: img, width: img.naturalWidth, height: img.naturalHeight, release: () => {} };
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Focus measure: mean squared Laplacian per tile, then a high percentile
  // of the tiles. A sharp subject with a soft background still scores well.
  function tiledSharpness(g, w, h, cfg) {
    const T = cfg.tiles;
    const sums = new Float64Array(T * T);
    const counts = new Uint32Array(T * T);
    for (let y = 1; y < h - 1; y++) {
      const ty = Math.min(T - 1, Math.floor((y * T) / h));
      for (let x = 1; x < w - 1; x++) {
        const i = y * w + x;
        const l = 4 * g[i] - g[i - 1] - g[i + 1] - g[i - w] - g[i + w];
        const t = ty * T + Math.min(T - 1, Math.floor((x * T) / w));
        sums[t] += l * l;
        counts[t]++;
      }
    }
    const vals = [];
    for (let t = 0; t < T * T; t++) if (counts[t]) vals.push(sums[t] / counts[t]);
    vals.sort((a, b) => a - b);
    return vals.length ? vals[Math.floor((vals.length - 1) * cfg.percentile)] : 0;
  }

  // 64-bit difference hash as a '0'/'1' string
  function dHash(source) {
    const c = document.createElement('canvas');
    c.width = 9;
    c.height = 8;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, 9, 8);
    const d = ctx.getImageData(0, 0, 9, 8).data;
    const g = [];
    for (let i = 0; i < 72; i++) g.push(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
    let bits = '';
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += g[y * 9 + x] > g[y * 9 + x + 1] ? '1' : '0';
    return bits;
  }

  function measure(img, cfg) {
    const p = cfg.photos;
    const scale = Math.min(1, p.analysisLongSide / Math.max(img.width, img.height));
    const w = Math.max(8, Math.round(img.width * scale));
    const h = Math.max(8, Math.round(img.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img.source, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    const n = w * h;
    const gray = new Float32Array(n);
    let sum = 0;
    let hi = 0;
    let lo = 0;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
      const y = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      gray[i] = y;
      sum += y;
      if (y >= 250) hi++;
      if (y <= 5) lo++;
    }

    return {
      width: img.width,
      height: img.height,
      shortSide: Math.min(img.width, img.height),
      sharpness: tiledSharpness(gray, w, h, p.sharpness),
      mean: sum / n,
      clipHigh: hi / n,
      clipLow: lo / n,
      hash: dHash(canvas),
    };
  }

  function analyzeImage(file, cfg) {
    if (analysisCache && analysisCache.has(file)) return analysisCache.get(file);
    const job = (async () => {
      const img = await decodeImage(file);
      try {
        if (!img.width || !img.height) throw new Error('empty image');
        return measure(img, cfg);
      } finally {
        img.release();
      }
    })();
    if (analysisCache) {
      analysisCache.set(file, job);
      job.catch(() => analysisCache.delete(file));
    }
    return job;
  }

  /* =====================================================================
   * 5. BLUEPRINT (layered SVG car)
   * Layers come from <g data-layer="name" data-from="score"> in the markup.
   * solid = score >= from · ghost = not yet unlocked · next layer is brighter
   * ===================================================================== */

  const NS = 'http://www.w3.org/2000/svg';
  const reduced = () => !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const P = (d, o) => Object.assign({ tag: 'path', d, w: 1.5, fill: 0, op: 1 }, o);
  const C = (cx, cy, r, o) => Object.assign({ tag: 'circle', cx, cy, r, w: 1.25, fill: 0, op: 1 }, o);

  const BODY =
    'M 70 232 L 128 232 A 48 48 0 1 1 212 232 L 418 232 A 48 48 0 1 1 502 232 L 572 232 ' +
    'C 584 232 588 224 588 212 C 588 196 580 176 562 168 L 440 148 L 376 100 ' +
    'C 366 93 354 91 336 91 L 262 91 C 246 91 238 95 226 106 L 186 140 ' +
    'C 178 146 168 146 156 146 L 100 148 C 80 150 70 162 70 182 Z';

  const wheel = (cx) => {
    const cy = 208;
    let spokes = '';
    for (let i = 0; i < 5; i++) {
      const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
      spokes += `M ${(cx + 7 * Math.cos(a)).toFixed(1)} ${(cy + 7 * Math.sin(a)).toFixed(1)} L ${(cx + 22 * Math.cos(a)).toFixed(1)} ${(cy + 22 * Math.sin(a)).toFixed(1)} `;
    }
    return [C(cx, cy, 42, { w: 1.75 }), C(cx, cy, 33, { w: 1 }), C(cx, cy, 22), C(cx, cy, 7, { w: 1 }), P(spokes, { w: 1.25 })];
  };

  let hatch = '';
  for (let x = 30; x <= 620; x += 22) hatch += `M ${x} 250 l -9 9 `;

  const BLUEPRINT = {
    ground: [
      P('M 20 250 H 620', { w: 1.5 }),
      P(hatch, { w: 0.75, op: 0.6 }),
      P('M 70 284 H 588 M 70 277 V 291 M 588 277 V 291', { w: 0.75, op: 0.7 }),
    ],
    chassis: [
      P('M 78 226 H 566 M 78 238 H 566 M 78 226 V 238 M 566 226 V 238', { w: 1.5 }),
      P('M 240 226 V 238 M 320 226 V 238 M 400 226 V 238', { w: 1 }),
      P('M 170 150 V 262 M 460 150 V 262', { w: 0.75, op: 0.7 }),
      P('M 150 238 L 170 208 L 190 238 M 440 238 L 460 208 L 480 238', { w: 1 }),
    ],
    wheels: wheel(170).concat(wheel(460)),
    drivetrain: [
      P('M 396 178 H 516 L 524 192 V 222 H 396 Z', { w: 1.5 }),
      P('M 406 178 V 164 H 506 V 178 M 432 164 V 178 M 456 164 V 178 M 480 164 V 178', { w: 1 }),
      P('M 340 194 H 396 V 222 H 340 Z', { w: 1.25 }),
      P('M 340 208 H 182', { w: 1.25 }),
      C(262, 208, 4, { w: 1 }),
      P('M 158 202 H 182 V 214 H 158 Z', { w: 1.25 }),
      P('M 430 222 C 400 246 330 244 280 244 H 96 M 96 244 H 76', { w: 1.25 }),
    ],
    body: [
      P(BODY, { w: 1.75 }),
      P('M 176 144 L 438 147', { w: 1 }),
      P('M 394 148 L 397 224 M 252 144 L 248 224 M 248 224 H 397', { w: 1 }),
      P('M 366 158 H 386', { w: 1.25 }),
      P('M 404 140 L 414 137 L 416 145 L 405 147 Z', { w: 1 }),
      P('M 448 150 L 556 171', { w: 0.75, op: 0.8 }),
      C(558, 186, 11, { w: 1.25 }),
      C(558, 186, 5, { w: 1 }),
      P('M 71 164 H 85 V 178 H 71 Z', { w: 1 }),
    ],
    glass: [
      P('M 432 145 L 374 103 C 365 97 354 95 336 95 L 264 95 C 252 95 245 99 235 109 L 198 142 Z', { w: 1.25, fill: 0.14 }),
      P('M 298 95 L 302 143', { w: 1 }),
      P('M 330 102 L 300 134 M 346 102 L 324 126', { w: 0.75, op: 0.6 }),
    ],
    paint: [
      P(BODY, { noStroke: true, fill: 0.2, noGhost: true }),
      P('M 120 178 C 220 170 330 168 440 174 C 490 178 530 186 560 192', { w: 1, op: 0.6, stroke: '#f4f0e6' }),
    ],
    badge: [
      C(560, 52, 24, { w: 1.5 }),
      C(560, 52, 19, { w: 1 }),
      P('M 549 52 L 557 60 L 572 43', { w: 2 }),
      { tag: 'text', text: 'SHORTLIST', x: 560, y: 94 },
    ],
  };

  function buildNode(def) {
    const el = document.createElementNS(NS, def.tag);
    if (def.tag === 'path') {
      el.setAttribute('d', def.d);
    } else if (def.tag === 'circle') {
      el.setAttribute('cx', def.cx);
      el.setAttribute('cy', def.cy);
      el.setAttribute('r', def.r);
    } else {
      el.textContent = def.text;
      el.setAttribute('x', def.x);
      el.setAttribute('y', def.y);
      el.setAttribute('text-anchor', 'middle');
      el.setAttribute('font-size', '9');
      el.setAttribute('letter-spacing', '1.5');
      el.setAttribute('fill', 'currentColor');
      el.setAttribute('stroke', 'none');
      el.style.opacity = '0';
      return el;
    }
    el.setAttribute('fill', 'currentColor');
    el.setAttribute('stroke', def.noStroke ? 'none' : def.stroke || 'currentColor');
    el.setAttribute('stroke-width', def.w);
    el.setAttribute('stroke-linecap', 'round');
    el.setAttribute('stroke-linejoin', 'round');
    el.style.fillOpacity = '0';
    el.style.opacity = '0';
    return el;
  }

  function createBlueprint(svg, caption) {
    const cfg = CONFIG.blueprint;
    const layers = Array.from(svg.querySelectorAll('[data-layer]')).map((g) => {
      const name = g.dataset.layer;
      while (g.firstChild) g.removeChild(g.firstChild);
      const nodes = (BLUEPRINT[name] || []).map((def) => {
        const el = buildNode(def);
        el._def = def;
        g.appendChild(el);
        try {
          el._len = def.tag === 'text' || def.noStroke ? 0 : el.getTotalLength();
        } catch (e) {
          el._len = 0;
        }
        return el;
      });
      return { name, from: parseFloat(g.dataset.from) || 0, nodes, mode: null, ghostOp: null };
    });
    const unlockable = layers.filter((l) => l.from > 0);

    function paintNode(node, mode, ghostOp, animate, delay) {
      const def = node._def;
      clearTimeout(node._t);
      const dur = cfg.drawMs;

      if (def.tag === 'text') {
        node.style.transition = animate ? `opacity 500ms ease ${delay}ms` : 'none';
        node.style.opacity = mode === 'solid' ? '1' : '0';
        return;
      }
      if (mode === 'solid') {
        if (def.noStroke || !node._len || !animate) {
          node.style.transition = animate ? `fill-opacity ${dur}ms ease ${delay}ms, opacity 300ms ease ${delay}ms` : 'none';
          node.style.strokeDasharray = 'none';
          node.style.strokeDashoffset = '0';
          node.style.opacity = String(def.op);
          node.style.fillOpacity = String(def.fill);
          return;
        }
        node.style.transition = 'none';
        node.style.strokeDasharray = String(node._len);
        node.style.strokeDashoffset = String(node._len);
        node.style.opacity = String(def.op);
        node.getBoundingClientRect(); // commit the start state
        node.style.transition = `stroke-dashoffset ${dur}ms cubic-bezier(0.2, 0, 0, 1) ${delay}ms, fill-opacity ${dur}ms ease ${delay + dur * 0.6}ms`;
        node.style.strokeDashoffset = '0';
        node.style.fillOpacity = String(def.fill);
        node._t = setTimeout(() => { node.style.strokeDasharray = 'none'; }, delay + dur + 80);
        return;
      }
      node.style.transition = animate ? 'opacity 300ms ease, fill-opacity 300ms ease' : 'none';
      node.style.fillOpacity = '0';
      if (def.noGhost || mode === 'hidden') {
        node.style.opacity = '0';
      } else {
        node.style.strokeDasharray = '3 5';
        node.style.strokeDashoffset = '0';
        node.style.opacity = String(ghostOp);
      }
    }

    function setScore(score, opts) {
      const animate = !(opts && opts.animate === false) && !reduced();
      const stagger = !!(opts && opts.stagger);
      const nextFrom = unlockable.map((l) => l.from).filter((f) => f > score).sort((a, b) => a - b)[0];
      let order = 0;

      layers.forEach((l) => {
        let mode;
        let ghostOp = null;
        if (score >= l.from) {
          mode = 'solid';
        } else {
          mode = 'ghost';
          ghostOp = l.from === nextFrom ? cfg.ghostNext : cfg.ghostLater;
        }
        if (l.mode === mode && l.ghostOp === ghostOp) return;
        const becomesSolid = mode === 'solid' && l.mode !== 'solid';
        const delay = becomesSolid && stagger && animate ? order++ * 200 : 0;
        l.nodes.forEach((n) => paintNode(n, mode, ghostOp, animate && l.mode !== null, delay));
        l.mode = mode;
        l.ghostOp = ghostOp;
      });

      if (caption) {
        const done = unlockable.filter((l) => l.mode === 'solid').length;
        caption.textContent = `Layer ${done} / ${unlockable.length}`;
      }
    }

    return { setScore };
  }

  /* =====================================================================
   * 6. UI
   * ===================================================================== */

  function initUI() {
    const cfg = CONFIG;
    const $ = (sel, ctx) => (ctx || document).querySelector(sel);
    const $$ = (sel, ctx) => Array.from((ctx || document).querySelectorAll(sel));

    const form = $('#precheck-form');
    if (!form) return;
    const stage = $('#precheck-stage');
    if (!stage) return;

    /* ---------- elements ---------- */
    const fields = {
      brand: form.elements.namedItem('brand'),
      model: form.elements.namedItem('model'),
      year: form.elements.namedItem('year'),
      description: form.elements.namedItem('description'),
    };
    const errorBox = $('[data-form-errors]');
    const counter = $('[data-char-count]');
    const photoCount = $('[data-photo-count]');
    const photoFieldset = $('[data-photo-fieldset]');
    const submitBtn = $('#precheck-submit');
    const submitLabel = submitBtn && $('[data-submit-label]', submitBtn);
    const staleNote = $('[data-stale-note]');
    const panels = $$('[data-panel]', stage);
    const resultEl = $('[data-panel="result"]', stage);
    const analyzingText = $('[data-analyzing-text]', stage);
    const progressBar = $('[data-progress]', stage);
    const gauge = $('[data-gauge]', stage);
    const gaugeArc = $('[data-gauge-arc]', stage);
    const scoreEl = $('[data-score]', stage);
    const tierEl = $('[data-tier]', stage);
    const tierMsg = $('[data-tier-message]', stage);
    const tipsList = $('[data-tips]', stage);
    const tipTpl = $('#precheck-tip-template');
    const applyLink = $('[data-apply-link]', stage);
    const resetBtn = $('[data-reset]', stage);
    const metricEls = $$('[data-metric]', stage);

    const blueprintSvg = $('[data-blueprint]', stage);
    const blueprint = blueprintSvg ? createBlueprint(blueprintSvg, $('[data-layer-caption]', stage)) : { setScore() {} };
    blueprint.setScore(0, { animate: false });

    const CIRC = gaugeArc ? 2 * Math.PI * parseFloat(gaugeArc.getAttribute('r') || '52') : 0;

    // Screen-reader announcements (kept separate so the counting animation stays quiet)
    const live = document.createElement('p');
    live.className = 'sr-only';
    live.setAttribute('role', 'status');
    live.setAttribute('aria-live', 'polite');
    form.appendChild(live);
    const announce = (msg) => {
      live.textContent = '';
      setTimeout(() => { live.textContent = msg; }, 60);
    };
    if (resultEl) resultEl.setAttribute('aria-live', 'off');
    stage.style.scrollMarginTop = '96px';

    /* ---------- brand suggestions ---------- */
    const dl = $('#precheck-brand-list');
    if (dl) {
      cfg.brands.forEach((b) => {
        const o = document.createElement('option');
        o.value = b.name;
        dl.appendChild(o);
      });
    }

    /* ---------- state ---------- */
    let busy = false;
    let lastResult = null; // { signature, values, result }
    let raf = 0;

    /* ---------- photo slots ---------- */
    const slots = $$('[data-slot]', form).map((el) => {
      const s = {
        id: el.dataset.slot,
        el,
        optional: el.hasAttribute('data-optional'),
        input: $('[data-slot-input]', el),
        preview: $('[data-slot-preview]', el),
        icon: $('[data-slot-icon]', el),
        check: $('[data-slot-check]', el),
        clear: $('[data-slot-clear]', el),
        error: $('[data-slot-error]', el),
        file: null,
        url: null,
      };
      s.input.id = 'precheck-photo-' + s.id;
      return s;
    });
    const slotName = (s) => cfg.photos.names[s.id] || s.id;
    const requiredSlots = slots.filter((s) => !s.optional);

    function showSlotError(s, msg) {
      if (!s.error) return;
      s.error.textContent = msg;
      s.error.classList.remove('hidden');
    }
    function clearSlotError(s) {
      if (!s.error) return;
      s.error.textContent = '';
      s.error.classList.add('hidden');
    }

    function validateFile(file) {
      if (!cfg.photos.types.includes(file.type)) return cfg.messages.badType;
      if (file.size > cfg.photos.maxBytes) return cfg.messages.tooBig;
      return null;
    }

    function updatePhotoCount() {
      if (photoCount) photoCount.textContent = String(requiredSlots.filter((s) => s.file).length);
    }

    function setSlotFile(s, file) {
      const err = validateFile(file);
      if (err) {
        showSlotError(s, err);
        return false;
      }
      clearSlotError(s);
      if (s.url) URL.revokeObjectURL(s.url);
      s.file = file;
      s.url = URL.createObjectURL(file);
      s.preview.src = s.url;
      s.preview.alt = `Preview of the ${slotName(s)} photo`;
      s.preview.classList.remove('hidden');
      if (s.icon) s.icon.classList.add('hidden');
      if (s.check) { s.check.classList.remove('hidden'); s.check.classList.add('flex'); }
      if (s.clear) { s.clear.classList.remove('hidden'); s.clear.classList.add('flex'); }
      updatePhotoCount();
      return true;
    }

    function clearSlot(s) {
      if (s.url) URL.revokeObjectURL(s.url);
      s.file = null;
      s.url = null;
      s.input.value = '';
      s.preview.removeAttribute('src');
      s.preview.alt = '';
      s.preview.classList.add('hidden');
      if (s.icon) s.icon.classList.remove('hidden');
      if (s.check) { s.check.classList.add('hidden'); s.check.classList.remove('flex'); }
      if (s.clear) { s.clear.classList.add('hidden'); s.clear.classList.remove('flex'); }
      clearSlotError(s);
      updatePhotoCount();
    }

    slots.forEach((s) => {
      s.input.addEventListener('change', () => {
        const f = s.input.files && s.input.files[0];
        s.input.value = ''; // allows choosing the same file again later
        if (f) {
          setSlotFile(s, f);
          refreshStale();
        }
      });
      if (s.clear) {
        s.clear.addEventListener('click', () => {
          clearSlot(s);
          s.input.focus();
          refreshStale();
        });
      }
    });

    /* ---------- drag & drop: one file -> that tile, several -> next empty tiles ---------- */
    const dragClasses = ['ring-2', 'ring-accent-brass', 'ring-offset-8', 'rounded-sm'];
    const setDrag = (on) => photoFieldset && dragClasses.forEach((c) => photoFieldset.classList.toggle(c, on));
    const hasFiles = (e) => e.dataTransfer && Array.from(e.dataTransfer.types || []).includes('Files');

    function distribute(files) {
      const valid = [];
      let rejected = 0;
      files.forEach((f) => (validateFile(f) ? rejected++ : valid.push(f)));
      const empty = requiredSlots.filter((s) => !s.file).concat(slots.filter((s) => s.optional && !s.file));
      let added = 0;
      let openedOptional = false;
      valid.forEach((f, i) => {
        const s = empty[i];
        if (s && setSlotFile(s, f)) {
          added++;
          if (s.optional) openedOptional = true;
        }
      });
      const skippedFull = Math.max(0, valid.length - empty.length);
      if (openedOptional) {
        const d = $('details', form);
        if (d) d.open = true;
      }
      const parts = [`${added} photo${added === 1 ? '' : 's'} added.`];
      if (rejected) parts.push(`${rejected} skipped: only JPG, PNG or WebP up to 10 MB.`);
      if (skippedFull) parts.push(`${skippedFull} skipped: no free slot.`);
      announce(parts.join(' '));
      refreshStale();
    }

    if (photoFieldset) {
      ['dragenter', 'dragover'].forEach((type) =>
        photoFieldset.addEventListener(type, (e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          setDrag(true);
        })
      );
      photoFieldset.addEventListener('dragleave', (e) => {
        if (!photoFieldset.contains(e.relatedTarget)) setDrag(false);
      });
      photoFieldset.addEventListener('drop', (e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        setDrag(false);
        const files = Array.from(e.dataTransfer.files);
        const li = e.target.closest && e.target.closest('[data-slot]');
        const tile = li && slots.find((s) => s.el === li);
        if (tile && files.length === 1) {
          if (setSlotFile(tile, files[0])) refreshStale();
        } else {
          distribute(files);
        }
      });
    }

    /* ---------- fields ---------- */
    const errEl = (name) => $(`[data-error-for="${name}"]`, form);

    function showFieldError(name, msg) {
      const el = errEl(name);
      if (el) {
        el.textContent = msg;
        el.classList.remove('hidden');
      }
      fields[name].setAttribute('aria-invalid', 'true');
      fields[name].classList.add('border-error-fg');
    }
    function clearFieldError(name) {
      const el = errEl(name);
      if (el) {
        el.textContent = '';
        el.classList.add('hidden');
      }
      fields[name].removeAttribute('aria-invalid');
      fields[name].classList.remove('border-error-fg');
    }

    const readFields = () => ({
      brand: fields.brand.value.trim(),
      model: fields.model.value.trim(),
      year: fields.year.value.trim(),
      description: fields.description.value.trim(),
    });

    fields.year.addEventListener('input', () => {
        formatYearField(fields.year);
    });

    const updateCounter = () => { if (counter) counter.textContent = String(fields.description.value.length); };

    Object.keys(fields).forEach((name) => {
      fields[name].addEventListener('input', () => {
        clearFieldError(name);
        if (name === 'description') updateCounter();
        refreshStale();
      });
    });
    updateCounter();
    updatePhotoCount();

    /* ---------- validation ---------- */
    function validate() {
      const errors = [];
      const v = readFields();
      const maxYear = new Date().getFullYear() + cfg.year.futureYears;

      Object.keys(fields).forEach(clearFieldError);
      slots.forEach(clearSlotError);

      if (!v.brand) errors.push({ field: 'brand', message: 'Enter the brand of your car.' });
      if (!v.model) errors.push({ field: 'model', message: 'Enter the model of your car.' });
      if (!v.year) {
        errors.push({ field: 'year', message: 'Enter the model year.' });
      } else if (!isValidYear(Number(v.year), new Date().getFullYear(), cfg)) {
        errors.push({ field: 'year', message: `Enter a year between ${cfg.year.min} and ${maxYear}.` });
      }
      if (v.description.length < cfg.story.minDescription) {
        errors.push({
          field: 'description',
          message: `Add a few words about what makes it special (at least ${cfg.story.minDescription} characters).`,
        });
      }

      const missing = requiredSlots.filter((s) => !s.file);
      missing.forEach((s) => showSlotError(s, 'Add this photo.'));
      if (missing.length) {
        errors.push({ slot: missing[0], message: `Add the missing photos: ${missing.map(slotName).join(', ')}.` });
      }
      return errors;
    }

    

    function showErrors(errors) {
      errors.forEach((e) => { if (e.field) showFieldError(e.field, e.message); });
      if (!errorBox) return;
      errorBox.replaceChildren();
      const head = document.createElement('p');
      head.className = 'mb-2 font-medium text-red-800';
      head.textContent = errors.length === 1 ? 'One thing needs your attention:' : `${errors.length} things need your attention:`;
      const ul = document.createElement('ul');
      ul.className = 'list-disc ps-5';
      ul.style = 'color:#991B1B'
      errors.forEach((e) => {
        const li = document.createElement('li');
        const target = e.field ? fields[e.field] : e.slot ? e.slot.input : null;
        if (target) {
          const a = document.createElement('a');
          a.href = '#' + target.id;
          a.className = 'underline text-red-800';
          a.textContent = e.message;
          a.addEventListener('click', (ev) => { ev.preventDefault(); target.focus(); });
          li.appendChild(a);
        } else {
          li.textContent = e.message;
        }
        ul.appendChild(li);
      });
      errorBox.append(head, ul);
      errorBox.classList.remove('hidden');
      errorBox.focus();
    }

    function hideErrors() {
      if (!errorBox) return;
      errorBox.classList.add('hidden');
      errorBox.replaceChildren();
    }

    /* ---------- stale detection ---------- */
    const signature = () =>
      JSON.stringify([
        readFields(),
        slots.map((s) => (s.file ? `${s.file.name}:${s.file.size}:${s.file.lastModified}` : '')),
      ]);

    function refreshStale() {
      if (!lastResult || !staleNote) return;
      staleNote.classList.toggle('hidden', signature() === lastResult.signature);
    }

    /* ---------- stage states ---------- */
    function setStage(state) {
      stage.dataset.state = state;
      panels.forEach((p) => { p.hidden = p.dataset.panel !== state; });
    }

    function setBusy(on) {
      if (!submitBtn) return;
      if (on) submitBtn.setAttribute('aria-busy', 'true');
      else submitBtn.removeAttribute('aria-busy');
      if (submitLabel) {
        submitLabel.textContent = on ? cfg.ui.busyLabel : lastResult ? cfg.ui.againLabel : cfg.ui.defaultLabel;
      }
    }

    const STEPS = {
      details: 'Checking the details\u2026',
      photos: 'Looking at your photographs\u2026',
      story: 'Reading your story\u2026',
      final: 'Weighing it all up\u2026',
    };
    let shownText = '';
    function setProgress(pct, text) {
      if (progressBar) progressBar.style.width = pct + '%';
      if (text && text !== shownText && analyzingText) {
        analyzingText.textContent = text;
        shownText = text;
      }
    }
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));

    /* ---------- analysis ---------- */
    async function runAnalysis(values) {
      const started = performance.now();
      const photos = [];
      const failed = [];
      const withFiles = slots.filter((s) => s.file);

      for (let i = 0; i < withFiles.length; i++) {
        const s = withFiles[i];
        setProgress(10 + (70 * i) / withFiles.length, STEPS.photos);
        try {
          photos.push({ slot: s.id, optional: s.optional, metrics: await analyzeImage(s.file, cfg) });
        } catch (e) {
          failed.push(s);
        }
      }
      if (failed.length) return { failed };

      setProgress(88, STEPS.story);
      const input = {
        brand: values.brand,
        model: values.model,
        year: Number(values.year),
        description: values.description,
        photos,
        currentYear: new Date().getFullYear(),
      };
      const result = evaluate(input, cfg);

      setProgress(96, STEPS.final);
      const remaining = cfg.ui.minAnalysisMs - (performance.now() - started);
      if (remaining > 0) await wait(reduced() ? Math.min(remaining, 300) : remaining);
      setProgress(100);
      return { input, result };
    }

    /* ---------- result ---------- */
    function paintGauge(shown, fraction) {
      if (scoreEl) scoreEl.textContent = String(shown);
      if (gaugeArc) gaugeArc.style.strokeDashoffset = String(CIRC * (1 - fraction));
    }

    function animateScore(target) {
      cancelAnimationFrame(raf);
      if (gauge) {
        gauge.setAttribute('aria-valuenow', String(target));
        gauge.setAttribute('aria-valuetext', `${target} out of 100`);
      }
      blueprint.setScore(0, { animate: false });
      if (reduced()) {
        paintGauge(target, target / 100);
        blueprint.setScore(target, { animate: false });
        return;
      }
      const start = performance.now();
      const step = (now) => {
        const t = clamp((now - start) / cfg.ui.countUpMs, 0, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        paintGauge(Math.round(target * eased), (target * eased) / 100);
        blueprint.setScore(Math.round(target * eased));
        if (t < 1) raf = requestAnimationFrame(step);
      };
      paintGauge(0, 0);
      raf = requestAnimationFrame(step);
    }

    function renderResult(result) {
      if (tierEl) tierEl.textContent = result.tier.label;
      if (tierMsg) tierMsg.textContent = result.tier.message + (result.capped ? ' ' + cfg.messages.capped : '');

      metricEls.forEach((li) => {
        const bar = $('[data-metric-bar]', li);
        const val = $('[data-metric-value]', li);
        if (val) val.textContent = String(result.areas[li.dataset.metric] || 0);
        if (bar) bar.style.width = '0%';
      });
      void stage.offsetWidth; // restart the bar transition
      requestAnimationFrame(() => {
        metricEls.forEach((li) => {
          const bar = $('[data-metric-bar]', li);
          if (bar) bar.style.width = (result.areas[li.dataset.metric] || 0) + '%';
        });
      });

      if (tipsList && tipTpl) {
        tipsList.replaceChildren();
        result.tips.forEach((tip) => {
          const node = tipTpl.content.cloneNode(true);
          $('[data-tip-text]', node).textContent = tip.text;
          const g = $('[data-tip-gain]', node);
          if (g) g.textContent = tip.gain ? `(+${tip.gain})` : '';
          tipsList.appendChild(node);
        });
      }

      animateScore(result.total);
      announce(
        `Readiness score ${result.total} out of 100, ${result.tier.label}. ` + result.tips.map((t) => t.text).join(' ')
      );
    }

    function revealStage() {
      const r = stage.getBoundingClientRect();
      const comfortable = r.top >= 0 && r.top < window.innerHeight * 0.5;
      if (!comfortable && window.innerWidth < 1024) {
        stage.scrollIntoView({ behavior: reduced() ? 'auto' : 'smooth', block: 'start' });
      }
      if (resultEl) resultEl.focus({ preventScroll: true });
    }

    /* ---------- submit ---------- */
    async function onSubmit(e) {
      e.preventDefault();
      if (busy) return;

      const errors = validate();
      if (errors.length) {
        showErrors(errors);
        return;
      }
      hideErrors();

      busy = true;
      setBusy(true);
      const previous = stage.dataset.state === 'analyzing' ? 'idle' : stage.dataset.state;
      const sig = signature();
      const values = readFields();
      setStage('analyzing');
      shownText = '';
      setProgress(4, STEPS.details);

      try {
        const out = await runAnalysis(values);
        if (out.failed) {
          out.failed.forEach((s) => showSlotError(s, cfg.messages.unreadable));
          setStage(previous);
          showErrors([{ slot: out.failed[0], message: `We could not read: ${out.failed.map(slotName).join(', ')}.` }]);
          return;
        }
        lastResult = { signature: sig, values, result: out.result };
        if (staleNote) staleNote.classList.add('hidden');
        setStage('result');
        renderResult(out.result);
        revealStage();
      } catch (err) {
        console.error(err);
        setStage(previous);
        showErrors([{ message: 'Something went wrong while reviewing your build. Please try again.' }]);
      } finally {
        busy = false;
        setBusy(false);
      }
    }

    form.addEventListener('submit', onSubmit);

    // The submit button may sit outside the <form>. Without form="precheck-form"
    // it would do nothing, so route the click ourselves.
    if (submitBtn) {
      submitBtn.addEventListener('click', (e) => {
        if (submitBtn.form) return;
        e.preventDefault();
        if (form.requestSubmit) form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      });
    }

    /* ---------- apply + reset ---------- */
    if (applyLink) {
      applyLink.addEventListener('click', () => {
        if (!lastResult) return;
        const v = lastResult.values;
        try {
          sessionStorage.setItem(
            cfg.ui.storageKey,
            JSON.stringify({
              brand: v.brand,
              model: v.model,
              year: v.year,
              description: v.description,
              score: lastResult.result.total,
              tier: lastResult.result.tier.label,
              createdAt: Date.now(),
            })
          );
        } catch (err) {
          /* storage blocked: the link still works, just without pre-fill */
        }
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        cancelAnimationFrame(raf);
        form.reset();
        slots.forEach(clearSlot);
        Object.keys(fields).forEach(clearFieldError);
        hideErrors();
        updateCounter();
        lastResult = null;
        if (staleNote) staleNote.classList.add('hidden');
        if (submitLabel) submitLabel.textContent = cfg.ui.defaultLabel;
        setStage('idle');
        blueprint.setScore(0, { animate: false });
        fields.brand.focus();
      });
    }

    setStage('idle');
  }

  /* =====================================================================
   * Bootstrap + exports
   * ===================================================================== */

  const api = {
    CONFIG,
    evaluate,
    scoreVehicle,
    scoreStory,
    scorePresentation,
    scoreCompleteness,
    normalizeText,
    levenshtein,
    init: initUI,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api; // Node: scoring only, DOM is never touched
  } else {
    root.PreCheck = api;
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initUI);
      else initUI();
    }
  }
})(typeof window !== 'undefined' ? window : globalThis);