export type SupportedCountry = 'India' | 'Bangladesh' | 'Nepal' | 'Bhutan';

export interface ResolvedPostalInfo {
  matchedKey: string;
  cityLabel: string;
  pinCode: string;
  country: SupportedCountry;
  stateCode?: string;
  stateName?: string;
  source: 'offline' | 'api' | 'address-pin';
}

export const COUNTRY_PIN_DIGIT_LENGTH: Record<SupportedCountry, number> = {
  India: 6,
  Bangladesh: 4,
  Nepal: 5,
  Bhutan: 5,
};

export function validatePinForCountry(pin: string, country: SupportedCountry): boolean {
  const clean = String(pin || '').trim();
  if (!clean) return false;
  const len = COUNTRY_PIN_DIGIT_LENGTH[country];
  return new RegExp(`^\\d{${len}}$`).test(clean);
}

interface OfflineHubEntry {
  aliases: string[];
  cityLabel: string;
  pinCode: string;
  country: SupportedCountry;
  stateCode?: string;
  stateName?: string;
}

const OFFLINE_HUB_ENTRIES: OfflineHubEntry[] = [
  // ==================== INDIA (6-digit) ====================
  { aliases: ['kolkata', 'calcutta', 'kol-hq', 'kolkata hq', 'kol', 'howrah maidan'], cityLabel: 'Kolkata', pinCode: '700001', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['baranagar', 'barahanagar', 'bt road baranagar', 'dunlop', 'bonhooghly'], cityLabel: 'Baranagar', pinCode: '700036', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['nawapara', 'noapara'], cityLabel: 'Nawapara', pinCode: '700090', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['petrapole', 'petrapole icp', 'bongaon petrapole'], cityLabel: 'Petrapole', pinCode: '743405', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['bongaon', 'bangaon'], cityLabel: 'Bongaon', pinCode: '743235', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['jaigaon', 'jaigaon border', 'jaigaon icp'], cityLabel: 'Jaigaon', pinCode: '736182', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['raxaul', 'raxaul icp', 'raxaul border'], cityLabel: 'Raxaul', pinCode: '845305', country: 'India', stateCode: '10', stateName: 'Bihar' },
  { aliases: ['siliguri', 'matigara', 'bagdogra'], cityLabel: 'Siliguri', pinCode: '734001', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['howrah', 'sankrail', 'dhulagarh', 'uluberia'], cityLabel: 'Howrah', pinCode: '711101', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['dankuni', 'singur'], cityLabel: 'Dankuni', pinCode: '712311', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['haldia', 'haldia dock'], cityLabel: 'Haldia', pinCode: '721602', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['durgapur'], cityLabel: 'Durgapur', pinCode: '713201', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['asansol', 'raniganj'], cityLabel: 'Asansol', pinCode: '713301', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['kharagpur', 'midnapore'], cityLabel: 'Kharagpur', pinCode: '721301', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['malda', 'english bazar'], cityLabel: 'Malda', pinCode: '732101', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['mahadipur', 'mahadipur border'], cityLabel: 'Mahadipur', pinCode: '732216', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['raiganj'], cityLabel: 'Raiganj', pinCode: '733134', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['hili', 'hili border', 'balurghat hili'], cityLabel: 'Hili', pinCode: '733126', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['cooch behar', 'coochbehar'], cityLabel: 'Cooch Behar', pinCode: '736101', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['changrabandha', 'changrabandha border'], cityLabel: 'Changrabandha', pinCode: '735301', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['alipurduar', 'hasimara'], cityLabel: 'Alipurduar', pinCode: '736121', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['panitanki', 'naxalbari', 'khoribari'], cityLabel: 'Panitanki', pinCode: '734429', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['jalpaiguri'], cityLabel: 'Jalpaiguri', pinCode: '735101', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['barrackpore', 'titagarh', 'khardah', 'sodepur'], cityLabel: 'Barrackpore', pinCode: '700120', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['salt lake', 'bidhannagar'], cityLabel: 'Salt Lake', pinCode: '700091', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['ghojadanga', 'basirhat'], cityLabel: 'Ghojadanga', pinCode: '743222', country: 'India', stateCode: '19', stateName: 'West Bengal' },
  { aliases: ['guwahati', 'dispur', 'amigaon'], cityLabel: 'Guwahati', pinCode: '781001', country: 'India', stateCode: '18', stateName: 'Assam' },
  { aliases: ['silchar', 'sutarkandi'], cityLabel: 'Silchar', pinCode: '788001', country: 'India', stateCode: '18', stateName: 'Assam' },
  { aliases: ['agartala', 'agartala icp'], cityLabel: 'Agartala', pinCode: '799001', country: 'India', stateCode: '16', stateName: 'Tripura' },
  { aliases: ['jogbani', 'jogbani border'], cityLabel: 'Jogbani', pinCode: '854328', country: 'India', stateCode: '10', stateName: 'Bihar' },
  { aliases: ['patna', 'patliputra', 'hajipur'], cityLabel: 'Patna', pinCode: '800001', country: 'India', stateCode: '10', stateName: 'Bihar' },
  { aliases: ['muzaffarpur'], cityLabel: 'Muzaffarpur', pinCode: '842001', country: 'India', stateCode: '10', stateName: 'Bihar' },
  { aliases: ['gaya'], cityLabel: 'Gaya', pinCode: '823001', country: 'India', stateCode: '10', stateName: 'Bihar' },
  { aliases: ['ranchi', 'jharkhand', 'hatia'], cityLabel: 'Ranchi', pinCode: '834001', country: 'India', stateCode: '20', stateName: 'Jharkhand' },
  { aliases: ['jamshedpur', 'tatanagar', 'adityapur'], cityLabel: 'Jamshedpur', pinCode: '831001', country: 'India', stateCode: '20', stateName: 'Jharkhand' },
  { aliases: ['dhanbad', 'jharia'], cityLabel: 'Dhanbad', pinCode: '826001', country: 'India', stateCode: '20', stateName: 'Jharkhand' },
  { aliases: ['bokaro', 'bokaro steel city'], cityLabel: 'Bokaro', pinCode: '827001', country: 'India', stateCode: '20', stateName: 'Jharkhand' },
  { aliases: ['hazaribagh'], cityLabel: 'Hazaribagh', pinCode: '825301', country: 'India', stateCode: '20', stateName: 'Jharkhand' },
  { aliases: ['bhubaneswar', 'khordha'], cityLabel: 'Bhubaneswar', pinCode: '751001', country: 'India', stateCode: '21', stateName: 'Odisha' },
  { aliases: ['cuttack', 'paradeep'], cityLabel: 'Cuttack', pinCode: '753001', country: 'India', stateCode: '21', stateName: 'Odisha' },
  { aliases: ['rourkela'], cityLabel: 'Rourkela', pinCode: '769001', country: 'India', stateCode: '21', stateName: 'Odisha' },
  { aliases: ['sambalpur', 'jharsuguda'], cityLabel: 'Sambalpur', pinCode: '768001', country: 'India', stateCode: '21', stateName: 'Odisha' },
  { aliases: ['varanasi', 'benaras', 'kashi', 'chandauli', 'mughalsarai'], cityLabel: 'Varanasi', pinCode: '221001', country: 'India', stateCode: '09', stateName: 'Uttar Pradesh' },
  { aliases: ['lucknow'], cityLabel: 'Lucknow', pinCode: '226001', country: 'India', stateCode: '09', stateName: 'Uttar Pradesh' },
  { aliases: ['kanpur'], cityLabel: 'Kanpur', pinCode: '208001', country: 'India', stateCode: '09', stateName: 'Uttar Pradesh' },
  { aliases: ['sonauli', 'nautanwa'], cityLabel: 'Sonauli', pinCode: '273164', country: 'India', stateCode: '09', stateName: 'Uttar Pradesh' },
  { aliases: ['rupaidiha', 'bahraich'], cityLabel: 'Rupaidiha', pinCode: '271881', country: 'India', stateCode: '09', stateName: 'Uttar Pradesh' },
  { aliases: ['noida', 'greater noida', 'ghaziabad'], cityLabel: 'Noida', pinCode: '201301', country: 'India', stateCode: '09', stateName: 'Uttar Pradesh' },
  { aliases: ['new delhi', 'delhi', 'ncr'], cityLabel: 'New Delhi', pinCode: '110001', country: 'India', stateCode: '07', stateName: 'Delhi' },
  { aliases: ['gurugram', 'gurgaon', 'faridabad'], cityLabel: 'Gurugram', pinCode: '122001', country: 'India', stateCode: '06', stateName: 'Haryana' },
  { aliases: ['mumbai', 'bombay'], cityLabel: 'Mumbai', pinCode: '400001', country: 'India', stateCode: '27', stateName: 'Maharashtra' },
  { aliases: ['navi mumbai', 'vashi', 'kalamboli', 'panvel'], cityLabel: 'Navi Mumbai', pinCode: '400703', country: 'India', stateCode: '27', stateName: 'Maharashtra' },
  { aliases: ['thane', 'bhiwandi'], cityLabel: 'Thane', pinCode: '400601', country: 'India', stateCode: '27', stateName: 'Maharashtra' },
  { aliases: ['pune', 'chakan'], cityLabel: 'Pune', pinCode: '411001', country: 'India', stateCode: '27', stateName: 'Maharashtra' },
  { aliases: ['nagpur'], cityLabel: 'Nagpur', pinCode: '440001', country: 'India', stateCode: '27', stateName: 'Maharashtra' },
  { aliases: ['ahmedabad'], cityLabel: 'Ahmedabad', pinCode: '380001', country: 'India', stateCode: '24', stateName: 'Gujarat' },
  { aliases: ['surat', 'hazira'], cityLabel: 'Surat', pinCode: '395001', country: 'India', stateCode: '24', stateName: 'Gujarat' },
  { aliases: ['vadodara', 'baroda'], cityLabel: 'Vadodara', pinCode: '390001', country: 'India', stateCode: '24', stateName: 'Gujarat' },
  { aliases: ['chennai', 'madras'], cityLabel: 'Chennai', pinCode: '600001', country: 'India', stateCode: '33', stateName: 'Tamil Nadu' },
  { aliases: ['bengaluru', 'bangalore'], cityLabel: 'Bengaluru', pinCode: '560001', country: 'India', stateCode: '29', stateName: 'Karnataka' },
  { aliases: ['hyderabad', 'secunderabad'], cityLabel: 'Hyderabad', pinCode: '500001', country: 'India', stateCode: '36', stateName: 'Telangana' },
  { aliases: ['visakhapatnam', 'vizag'], cityLabel: 'Visakhapatnam', pinCode: '530001', country: 'India', stateCode: '37', stateName: 'Andhra Pradesh' },
  { aliases: ['raipur'], cityLabel: 'Raipur', pinCode: '492001', country: 'India', stateCode: '22', stateName: 'Chhattisgarh' },
  { aliases: ['bilaspur'], cityLabel: 'Bilaspur', pinCode: '495001', country: 'India', stateCode: '22', stateName: 'Chhattisgarh' },
  { aliases: ['indore'], cityLabel: 'Indore', pinCode: '452001', country: 'India', stateCode: '23', stateName: 'Madhya Pradesh' },
  { aliases: ['jaipur'], cityLabel: 'Jaipur', pinCode: '302001', country: 'India', stateCode: '08', stateName: 'Rajasthan' },
  { aliases: ['ludhiana'], cityLabel: 'Ludhiana', pinCode: '141001', country: 'India', stateCode: '03', stateName: 'Punjab' },
  { aliases: ['chandigarh'], cityLabel: 'Chandigarh', pinCode: '160001', country: 'India', stateCode: '04', stateName: 'Chandigarh' },

  // ==================== BANGLADESH (4-digit) ====================
  { aliases: ['dhaka', 'motijheel', 'tejgaon', 'gazipur', 'bangladesh'], cityLabel: 'Dhaka', pinCode: '1000', country: 'Bangladesh' },
  { aliases: ['benapole', 'benapol', 'sharsha'], cityLabel: 'Benapole', pinCode: '7431', country: 'Bangladesh' },
  { aliases: ['chattogram', 'chittagong'], cityLabel: 'Chattogram', pinCode: '4000', country: 'Bangladesh' },
  { aliases: ['burimari', 'patgram'], cityLabel: 'Burimari', pinCode: '5541', country: 'Bangladesh' },
  { aliases: ['bhomra', 'satkhira'], cityLabel: 'Bhomra', pinCode: '9400', country: 'Bangladesh' },
  { aliases: ['jessore', 'jashore'], cityLabel: 'Jashore', pinCode: '7400', country: 'Bangladesh' },
  { aliases: ['khulna'], cityLabel: 'Khulna', pinCode: '9100', country: 'Bangladesh' },
  { aliases: ['sylhet'], cityLabel: 'Sylhet', pinCode: '3100', country: 'Bangladesh' },
  { aliases: ['rajshahi'], cityLabel: 'Rajshahi', pinCode: '6000', country: 'Bangladesh' },
  { aliases: ['cumilla', 'comilla'], cityLabel: 'Cumilla', pinCode: '3500', country: 'Bangladesh' },
  { aliases: ['narayanganj'], cityLabel: 'Narayanganj', pinCode: '1400', country: 'Bangladesh' },
  { aliases: ['bogura', 'bogra'], cityLabel: 'Bogura', pinCode: '5800', country: 'Bangladesh' },
  { aliases: ['savar'], cityLabel: 'Savar', pinCode: '1340', country: 'Bangladesh' },
  { aliases: ['tongi'], cityLabel: 'Tongi', pinCode: '1710', country: 'Bangladesh' },
  { aliases: ['akhaura'], cityLabel: 'Akhaura', pinCode: '3450', country: 'Bangladesh' },
  { aliases: ['sonamasjid'], cityLabel: 'Sonamasjid', pinCode: '6340', country: 'Bangladesh' },
  { aliases: ['tamabil'], cityLabel: 'Tamabil', pinCode: '3151', country: 'Bangladesh' },

  // ==================== NEPAL (5-digit) ====================
  { aliases: ['kathmandu', 'ktm', 'nepal'], cityLabel: 'Kathmandu', pinCode: '44600', country: 'Nepal' },
  { aliases: ['birgunj', 'birganj', 'parsa'], cityLabel: 'Birgunj', pinCode: '44300', country: 'Nepal' },
  { aliases: ['biratnagar', 'morang'], cityLabel: 'Biratnagar', pinCode: '56613', country: 'Nepal' },
  { aliases: ['kakarbhitta', 'kakarvitta', 'jhapa'], cityLabel: 'Kakarbhitta', pinCode: '57206', country: 'Nepal' },
  { aliases: ['bhairahawa', 'siddharthanagar', 'rupandehi'], cityLabel: 'Bhairahawa', pinCode: '32900', country: 'Nepal' },
  { aliases: ['nepalgunj', 'nepalganj', 'banke'], cityLabel: 'Nepalgunj', pinCode: '21900', country: 'Nepal' },
  { aliases: ['pokhara', 'kaski'], cityLabel: 'Pokhara', pinCode: '33700', country: 'Nepal' },
  { aliases: ['lalitpur', 'patan'], cityLabel: 'Lalitpur', pinCode: '44700', country: 'Nepal' },
  { aliases: ['bhaktapur'], cityLabel: 'Bhaktapur', pinCode: '44800', country: 'Nepal' },
  { aliases: ['janakpur'], cityLabel: 'Janakpur', pinCode: '45600', country: 'Nepal' },
  { aliases: ['hetauda'], cityLabel: 'Hetauda', pinCode: '44107', country: 'Nepal' },
  { aliases: ['butwal'], cityLabel: 'Butwal', pinCode: '32907', country: 'Nepal' },
  { aliases: ['dhangadhi'], cityLabel: 'Dhangadhi', pinCode: '10900', country: 'Nepal' },
  { aliases: ['krishnanagar'], cityLabel: 'Krishnanagar', pinCode: '32811', country: 'Nepal' },

  // ==================== BHUTAN (5-digit) ====================
  { aliases: ['thimphu', 'thimpu', 'bhutan'], cityLabel: 'Thimphu', pinCode: '11001', country: 'Bhutan' },
  { aliases: ['phuentsholing', 'phuntsholing', 'pasakha', 'chukha'], cityLabel: 'Phuentsholing', pinCode: '21101', country: 'Bhutan' },
  { aliases: ['gelephu', 'sarpang'], cityLabel: 'Gelephu', pinCode: '31101', country: 'Bhutan' },
  { aliases: ['samdrup jongkhar', 'samdrup'], cityLabel: 'Samdrup Jongkhar', pinCode: '41001', country: 'Bhutan' },
  { aliases: ['paro'], cityLabel: 'Paro', pinCode: '12001', country: 'Bhutan' },
  { aliases: ['punakha'], cityLabel: 'Punakha', pinCode: '13001', country: 'Bhutan' },
  { aliases: ['wangdue', 'wangdue phodrang'], cityLabel: 'Wangdue', pinCode: '14001', country: 'Bhutan' },
  { aliases: ['bumthang'], cityLabel: 'Bumthang', pinCode: '32001', country: 'Bhutan' },
  { aliases: ['trongsa'], cityLabel: 'Trongsa', pinCode: '33001', country: 'Bhutan' },
];

// Build fast alias index sorted longest-first for exact boundary matching inside free-text addresses
const SORTED_ALIAS_RECORDS: Array<{ alias: string; entry: OfflineHubEntry }> = OFFLINE_HUB_ENTRIES.flatMap(
  (entry) => entry.aliases.map((alias) => ({ alias: alias.toLowerCase(), entry }))
).sort((a, b) => b.alias.length - a.alias.length);

const apiLookupCache = new Map<string, ResolvedPostalInfo | null>();

function normalizeQuery(text: string): string {
  return String(text || '')
    .toLowerCase()
    .replace(/[(),.\-_/]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeRegExp(val: string): string {
  return val.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractExplicitPinFromText(
  rawText: string,
  countryHint?: SupportedCountry
): ResolvedPostalInfo | null {
  const txt = String(rawText || '').trim();
  if (!txt) return null;

  // Detect country cue in text first
  const lower = txt.toLowerCase();
  let inferredCountry: SupportedCountry | undefined = countryHint;
  if (/\bbangladesh\b/.test(lower)) inferredCountry = 'Bangladesh';
  else if (/\bnepal\b/.test(lower)) inferredCountry = 'Nepal';
  else if (/\bbhutan\b/.test(lower)) inferredCountry = 'Bhutan';
  else if (/\bindia\b/.test(lower)) inferredCountry = 'India';

  // Explicit 6-digit Indian PIN in address (e.g. 700036)
  const sixMatch = txt.match(/\b([1-8]\d{5})\b/);
  if (sixMatch && (!inferredCountry || inferredCountry === 'India')) {
    return {
      matchedKey: sixMatch[1],
      cityLabel: '',
      pinCode: sixMatch[1],
      country: 'India',
      source: 'address-pin',
    };
  }

  // Explicit 5-digit Nepal/Bhutan PIN when country is explicitly mentioned or hinted
  if (inferredCountry === 'Nepal' || inferredCountry === 'Bhutan') {
    const fiveMatch = txt.match(/\b(\d{5})\b/);
    if (fiveMatch) {
      return {
        matchedKey: fiveMatch[1],
        cityLabel: '',
        pinCode: fiveMatch[1],
        country: inferredCountry,
        source: 'address-pin',
      };
    }
  }

  // Explicit 4-digit Bangladesh postal code when Bangladesh is explicitly mentioned or hinted
  if (inferredCountry === 'Bangladesh') {
    const fourMatch = txt.match(/\b(\d{4})\b/);
    if (fourMatch) {
      return {
        matchedKey: fourMatch[1],
        cityLabel: '',
        pinCode: fourMatch[1],
        country: 'Bangladesh',
        source: 'address-pin',
      };
    }
  }

  return null;
}

/**
 * Synchronous exact offline resolver.
 * Guarantees verified official PIN codes for Kolkata (700001), Baranagar (700036),
 * Petrapole (743405), Jaigaon (736182), Raxaul (845305), Dhaka (1000), Benapole (7431),
 * Chattogram (4000), Kathmandu (44600), Birgunj (44300), Biratnagar (56613),
 * Kakarbhitta (57206), Thimphu (11001), Phuentsholing (21101), Gelephu (31101), etc.
 */
export function resolvePinSync(
  placeOrAddress: string,
  countryHint?: SupportedCountry
): ResolvedPostalInfo | null {
  const raw = String(placeOrAddress || '').trim();
  if (!raw || raw.length < 2) return null;

  // Check explicit route separator (e.g. "KOLKATA TO DHAKA" -> prioritize destination segment first)
  const routeParts = raw.split(/\bto\b|->|=>|→/i).map((p) => p.trim()).filter(Boolean);
  const candidatesToScan =
    routeParts.length > 1 ? [routeParts[routeParts.length - 1], raw] : [raw];

  for (const segment of candidatesToScan) {
    const normalized = normalizeQuery(segment);
    if (!normalized) continue;

    // 1. Exact full match against offline hub alias
    for (const item of SORTED_ALIAS_RECORDS) {
      if (countryHint && item.entry.country !== countryHint) continue;
      if (normalized === item.alias) {
        return {
          matchedKey: item.alias,
          cityLabel: item.entry.cityLabel,
          pinCode: item.entry.pinCode,
          country: item.entry.country,
          stateCode: item.entry.stateCode,
          stateName: item.entry.stateName,
          source: 'offline',
        };
      }
    }

    // 2. Word-boundary match inside full address or branch string
    for (const item of SORTED_ALIAS_RECORDS) {
      if (countryHint && item.entry.country !== countryHint) continue;
      const re = new RegExp(`(?:^|\\s)${escapeRegExp(item.alias)}(?:\\s|$)`, 'i');
      if (re.test(normalized)) {
        return {
          matchedKey: item.alias,
          cityLabel: item.entry.cityLabel,
          pinCode: item.entry.pinCode,
          country: item.entry.country,
          stateCode: item.entry.stateCode,
          stateName: item.entry.stateName,
          source: 'offline',
        };
      }
    }
  }

  // 3. Fallback: explicit PIN typed in address string itself
  return extractExplicitPinFromText(raw, countryHint);
}

/**
 * Combines verified offline lookup (always wins for accuracy) with live India Postal API
 * fallback for unknown Indian cities/post offices, strictly validating digit format per country.
 */
export async function lookupExactPinAndCountry(
  placeOrAddress: string,
  countryHint?: SupportedCountry
): Promise<ResolvedPostalInfo | null> {
  const offline = resolvePinSync(placeOrAddress, countryHint);
  if (offline && validatePinForCountry(offline.pinCode, offline.country)) {
    return offline;
  }

  const raw = String(placeOrAddress || '').trim();
  if (!raw || raw.length < 3) return null;
  if (countryHint && countryHint !== 'India') return null;
  if (/\b(bangladesh|nepal|bhutan)\b/i.test(raw)) return null;

  // Clean candidate token (if route like "A to B", inspect last segment; if comma address, inspect last non-number segment)
  const segments = raw
    .split(/[,|]+|\bto\b|->/i)
    .map((s) => s.replace(/\d+/g, '').trim())
    .filter((s) => s.length >= 3);
  const queryTerm = segments.length > 0 ? segments[segments.length - 1] : raw;
  const cleanKey = normalizeQuery(queryTerm);
  if (!cleanKey || cleanKey.length < 3) return null;

  if (apiLookupCache.has(cleanKey)) {
    return apiLookupCache.get(cleanKey) || null;
  }

  // Query official Postal PIN API for India when online
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(
      `https://api.postalpincode.in/postoffice/${encodeURIComponent(queryTerm.trim())}`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!resp.ok) {
      apiLookupCache.set(cleanKey, null);
      return null;
    }
    const json = (await resp.json()) as Array<{
      Status?: string;
      PostOffice?: Array<{
        Name?: string;
        District?: string;
        State?: string;
        Pincode?: string;
        BranchType?: string;
      }>;
    }>;
    const first = Array.isArray(json) ? json[0] : undefined;
    if (first?.Status === 'Success' && Array.isArray(first.PostOffice) && first.PostOffice.length > 0) {
      // Prefer Head Post Office / Sub Office or exact Name/District match
      const qLower = queryTerm.trim().toLowerCase();
      const preferred =
        first.PostOffice.find(
          (po) =>
            String(po.Name || '').trim().toLowerCase() === qLower &&
            /^\d{6}$/.test(String(po.Pincode || ''))
        ) ||
        first.PostOffice.find(
          (po) =>
            String(po.BranchType || '').toLowerCase().includes('head') &&
            /^\d{6}$/.test(String(po.Pincode || ''))
        ) ||
        first.PostOffice.find((po) => /^\d{6}$/.test(String(po.Pincode || '')));

      if (preferred && preferred.Pincode && validatePinForCountry(preferred.Pincode, 'India')) {
        const result: ResolvedPostalInfo = {
          matchedKey: cleanKey,
          cityLabel: preferred.District || preferred.Name || queryTerm.trim(),
          pinCode: preferred.Pincode.trim(),
          country: 'India',
          stateName: preferred.State,
          source: 'api',
        };
        apiLookupCache.set(cleanKey, result);
        return result;
      }
    }
    apiLookupCache.set(cleanKey, null);
    return null;
  } catch {
    return null;
  }
}
