import { verifyAdminPin } from './selfHealing';
import { BusinessMode, SheetTabId } from '../types/erp';

export type VoicePilotLang = 'bn' | 'en' | 'off';

const VOICE_LANG_STORAGE_KEY = 'drc_voice_pilot_lang_v1';
const VOICE_UNLOCK_SESSION_KEY = 'drc_voice_pilot_pin_unlocked_v1';

export interface VoiceDraftFields {
  partyName?: string;
  consignorName?: string;
  consigneeName?: string;
  fromCity?: string;
  toCity?: string;
  deliverAt?: string;
  destination?: string;
  truckNo?: string;
  driverName?: string;
  goodsDesc?: string;
  freight?: string;
  weight?: string;
  packages?: string;
  ewayBillNo?: string;
}

export interface VoiceCommandIntent {
  transcript: string;
  blockedAction?: 'save' | 'print';
  targetTab?: SheetTabId;
  targetBusinessMode?: BusinessMode;
  targetSubTab?: string;
  draftFields: VoiceDraftFields;
  spokenReplyBn: string;
  spokenReplyEn: string;
}

export function getStoredVoicePilotLang(): VoicePilotLang {
  try {
    const raw = localStorage.getItem(VOICE_LANG_STORAGE_KEY);
    if (raw === 'bn' || raw === 'en' || raw === 'off') return raw;
  } catch {
    // Ignore storage restriction
  }
  return 'en';
}

export function setStoredVoicePilotLang(lang: VoicePilotLang): void {
  try {
    localStorage.setItem(VOICE_LANG_STORAGE_KEY, lang);
  } catch {
    // Ignore storage restriction
  }
}

export function isVoicePilotUnlocked(): boolean {
  try {
    return sessionStorage.getItem(VOICE_UNLOCK_SESSION_KEY) === 'true';
  } catch {
    return false;
  }
}

export function unlockVoicePilotWithPin(pinInput: string): boolean {
  if (!verifyAdminPin(pinInput)) return false;
  try {
    sessionStorage.setItem(VOICE_UNLOCK_SESSION_KEY, 'true');
  } catch {
    // Ignore storage error
  }
  return true;
}

export function lockVoicePilot(): void {
  try {
    sessionStorage.removeItem(VOICE_UNLOCK_SESSION_KEY);
  } catch {
    // Ignore
  }
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // Ignore
    }
  }
}

export function speakCalmVoice(text: string, lang: VoicePilotLang): void {
  if (lang === 'off') return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  const clean = String(text || '').trim();
  if (!clean) return;
  try {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 0.92;
    utterance.pitch = 1.0;
    utterance.volume = 0.95;
    utterance.lang = lang === 'bn' ? 'bn-IN' : 'en-IN';
    const voices = window.speechSynthesis.getVoices() || [];
    const matched = voices.find((v) =>
      lang === 'bn'
        ? v.lang.toLowerCase().startsWith('bn')
        : v.lang.toLowerCase().startsWith('en-in') || v.lang.toLowerCase().startsWith('en')
    );
    if (matched) utterance.voice = matched;
    window.speechSynthesis.speak(utterance);
  } catch {
    // Ignore browser speech synthesis restriction
  }
}

export function getStaffReadOnlyVoiceHint(
  lang: VoicePilotLang,
  activeTab: string,
  businessMode: BusinessMode
): string {
  if (lang === 'bn') {
    return `স্টাফ রিড-অনলি ভয়েস হিন্ট: আপনি এখন ${businessMode} বিভাগে (${activeTab}) আছেন। ভয়েস দিয়ে ফর্ম সেভ, প্রিন্ট বা পরিবর্তন স্টাফের জন্য লক করা আছে; শুধুমাত্র অ্যাডমিন পিন আনলক করলে ড্রাফট পূরণ করা যাবে।`;
  }
  return `Staff read-only voice hint: You are viewing ${businessMode} module (${activeTab}). Form editing and screen navigation by voice require Admin PIN unlock. Manual Save and Print remain explicit only.`;
}

interface SpeechRecognitionAlternativeLike {
  transcript: string;
}

interface SpeechRecognitionResultLike {
  0: SpeechRecognitionAlternativeLike;
}

interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionInstanceLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => SpeechRecognitionInstanceLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getSpeechRecognitionCtor() !== null;
}

export function startVoiceListening(opts: {
  lang: VoicePilotLang;
  onResult: (transcript: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
}): (() => void) | null {
  const Ctor = getSpeechRecognitionCtor();
  if (!Ctor) {
    opts.onError('Speech recognition is not supported on this browser.');
    return null;
  }
  try {
    const recognition = new Ctor();
    recognition.lang = opts.lang === 'bn' ? 'bn-IN' : 'en-IN';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.continuous = false;

    recognition.onresult = (event) => {
      const text = String(event.results?.[0]?.[0]?.transcript || '').trim();
      if (text) opts.onResult(text);
    };
    recognition.onerror = (err) => {
      opts.onError(err?.error ? `Mic error: ${err.error}` : 'Microphone capture stopped.');
    };
    recognition.onend = () => {
      opts.onEnd();
    };
    recognition.start();
    return () => {
      try {
        recognition.stop();
      } catch {
        // Ignore stop error
      }
    };
  } catch {
    opts.onError('Unable to start microphone listener.');
    return null;
  }
}

export function parseVoiceCommandIntent(rawTranscript: string): VoiceCommandIntent {
  const transcript = String(rawTranscript || '').trim();
  const lower = transcript.toLowerCase();

  // Strictly refuse auto-save or auto-print via voice per security policy
  if (/\b(print|প্রিন্ট|ছাপাও)\b/i.test(lower)) {
    return {
      transcript,
      blockedAction: 'print',
      draftFields: {},
      spokenReplyBn:
        'নিরাপত্তা নীতি অনুযায়ী ভয়েস কমান্ড দিয়ে অটো-প্রিন্ট করা হয় না। দয়া করে স্ক্রিনে তথ্য দেখে নিজে প্রিন্ট বাটনে ক্লিক করুন।',
      spokenReplyEn:
        'For safety, auto-printing by voice is disabled. Please verify details on screen and click Print manually.',
    };
  }
  if (/\b(save|submit|সেভ|সংরক্ষণ)\b/i.test(lower)) {
    return {
      transcript,
      blockedAction: 'save',
      draftFields: {},
      spokenReplyBn:
        'নিরাপত্তা নীতি অনুযায়ী ভয়েস দিয়ে অটো-সেভ করা হয় না। ড্রাফট যাচাই করে নিজে সেভ বাটনে ক্লিক করুন।',
      spokenReplyEn:
        'For safety, auto-saving by voice is blocked. Review the draft fields and click Save manually.',
    };
  }

  let targetBusinessMode: BusinessMode | undefined;
  let targetTab: SheetTabId | undefined;
  let targetSubTab: string | undefined;

  // Business mode switching
  if (/\b(ptl|পার্সেল)\b/i.test(lower)) targetBusinessMode = 'PTL';
  else if (/\b(courier|কুরিয়ার)\b/i.test(lower)) targetBusinessMode = 'COURIER';
  else if (/\b(logistics|লজিস্টিক্স)\b/i.test(lower)) targetBusinessMode = 'LOGISTICS';
  else if (/\b(ftl|ট্রাক|ফুল লোড)\b/i.test(lower)) targetBusinessMode = 'FTL';

  // Screen navigation
  if (/\b(all in one|master sheet|bilty|lr|cn|বিল্টি|এলআর|এন্ট্রি শিট|মাস্টার শিট)\b/i.test(lower)) {
    targetTab = 'allInOne';
  } else if (/\b(quotation|quote|কোটেশন|দরপত্র)\b/i.test(lower)) {
    targetTab = 'billing';
    targetSubTab = 'quotation';
  } else if (/\b(194c|declaration|ডিক্লারেশন)\b/i.test(lower)) {
    targetTab = 'billing';
    targetSubTab = '194c';
  } else if (/\b(bill|billing|invoice|tax invoice|বিল|ইনভয়েস)\b/i.test(lower)) {
    targetTab = 'billing';
    targetSubTab = 'invoice';
  } else if (/\b(broker|ব্রোকার|দালাল)\b/i.test(lower)) {
    targetTab = 'master';
    targetSubTab = 'brokers';
  } else if (/\b(driver|ড্রাইভার|চালক)\b/i.test(lower)) {
    targetTab = 'master';
    targetSubTab = 'drivers';
  } else if (/\b(owner|লরি মালিক|মালিক)\b/i.test(lower)) {
    targetTab = 'master';
    targetSubTab = 'owners';
  } else if (/\b(party|parties|master|customer|পার্টি|মাস্টার|গ্রাহক)\b/i.test(lower)) {
    targetTab = 'master';
    targetSubTab = 'parties';
  } else if (/\b(lorry hire|lorry|pod|লরি|ভাড়া)\b/i.test(lower)) {
    targetTab = 'lorryHire';
  } else if (/\b(gst|report|reports|gstr|রিপোর্ট|জিএসটি)\b/i.test(lower)) {
    targetTab = 'reports';
  } else if (/\b(guide|book|help|গাইড|নিয়ম)\b/i.test(lower)) {
    targetTab = 'guide';
  } else if (/\b(dashboard|home|ড্যাশবোর্ড|হোম)\b/i.test(lower)) {
    targetTab = 'dashboard';
  }

  // Parse structured draft fields from voice phrase (English & Bengali)
  const draftFields: VoiceDraftFields = {};

  // Vehicle / Truck no (e.g. WB 23 C 6597 / WB23C6597)
  const truckMatch = transcript.match(/\b([A-Z]{2}\s*\d{1,2}\s*[A-Z]{1,3}\s*\d{3,4})\b/i);
  if (truckMatch) {
    draftFields.truckNo = truckMatch[1].replace(/\s+/g, '').toUpperCase();
  }

  // From -> To extraction (English: "from Kolkata to Siliguri" or "Kolkata to Dhaka", Bengali: "কলকাতা থেকে ঢাকা")
  const enRoute = transcript.match(
    /(?:from\s+)?([A-Za-z][A-Za-z\s]{2,22}?)\s+(?:to|থেকে)\s+([A-Za-z][A-Za-z\s]{2,22}?)(?:\s+(?:freight|amount|truck|party|weight|rs|rupees|টাকা|ভাড়া)|$)/i
  );
  const bnRoute = transcript.match(
    /([^\s,]+(?:\s+[^\s,]+)?)\s+থেকে\s+([^\s,]+(?:\s+[^\s,]+)?)/
  );
  if (enRoute) {
    draftFields.fromCity = enRoute[1].trim();
    draftFields.toCity = enRoute[2].trim();
    draftFields.destination = `${draftFields.fromCity} to ${draftFields.toCity}`;
  } else if (bnRoute) {
    draftFields.fromCity = bnRoute[1].trim();
    draftFields.toCity = bnRoute[2].trim();
    draftFields.destination = `${draftFields.fromCity} to ${draftFields.toCity}`;
  }

  // Freight / amount extraction
  const amtMatch = transcript.match(
    /(?:freight|amount|rate|rs|rupees|ভাড়া|টাকা)\s*[:\-]?\s*(\d{3,7})/i
  );
  if (amtMatch) {
    draftFields.freight = amtMatch[1];
  }

  // Party / Consignor / Consignee
  const partyMatch = transcript.match(
    /(?:party|customer|পার্টি)\s+([A-Za-z0-9\s.&'-]{2,40}?)(?:\s+(?:from|to|truck|freight|weight|driver)|$)/i
  );
  if (partyMatch) {
    draftFields.partyName = partyMatch[1].trim();
  }
  const consignorMatch = transcript.match(
    /(?:consignor|কনসাইনর)\s+([A-Za-z0-9\s.&'-]{2,40}?)(?:\s+(?:consignee|from|to|truck)|$)/i
  );
  if (consignorMatch) {
    draftFields.consignorName = consignorMatch[1].trim();
  }
  const consigneeMatch = transcript.match(
    /(?:consignee|কনসাইনি)\s+([A-Za-z0-9\s.&'-]{2,40}?)(?:\s+(?:from|to|truck|freight)|$)/i
  );
  if (consigneeMatch) {
    draftFields.consigneeName = consigneeMatch[1].trim();
  }

  // EWB 12-digit
  const ewbMatch = transcript.match(/\b(\d{12})\b/);
  if (ewbMatch) {
    draftFields.ewayBillNo = ewbMatch[1];
  }

  const filledCount = Object.keys(draftFields).length;
  const navLabelEn = targetTab
    ? `Opened ${targetTab}${targetSubTab ? ` (${targetSubTab})` : ''}`
    : targetBusinessMode
    ? `Switched to ${targetBusinessMode}`
    : 'Voice draft processed';
  const navLabelBn = targetTab
    ? `${targetTab} স্ক্রিন খোলা হয়েছে`
    : targetBusinessMode
    ? `${targetBusinessMode} বিভাগে পরিবর্তন করা হয়েছে`
    : 'ভয়েস ড্রাফট প্রসেস করা হয়েছে';

  return {
    transcript,
    targetBusinessMode,
    targetTab,
    targetSubTab,
    draftFields,
    spokenReplyBn:
      filledCount > 0
        ? `${navLabelBn} এবং ${filledCount}টি ড্রাফট ঘর পূরণ করা হয়েছে। যাচাই করে নিজে সেভ করুন।`
        : `${navLabelBn}।`,
    spokenReplyEn:
      filledCount > 0
        ? `${navLabelEn} and populated ${filledCount} draft field(s). Please verify before manual Save.`
        : `${navLabelEn}.`,
  };
}
