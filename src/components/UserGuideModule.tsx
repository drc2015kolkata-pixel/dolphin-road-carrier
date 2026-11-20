import React, { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, Search, ShieldCheck } from 'lucide-react';

interface GuideSection {
  id: string;
  badge: string;
  titleEn: string;
  titleBn: string;
  stepsEn: string[];
  stepsBn: string[];
}

const GUIDE_SECTIONS: GuideSection[] = [
  {
    id: 'security',
    badge: '1. Security & Access',
    titleEn: 'Mandatory Login Lock, FY Season Padlock & Staff Access Matrix',
    titleBn: 'লগইন লক, ফাইন্যান্সিয়াল ইয়ার প্যাডলক ও স্টাফ অ্যাক্সেস কন্ট্রোল',
    stepsEn: [
      'Sign in via Google Firebase Authentication (Master Admin) or authorized Staff PIN.',
      'The top Financial Year badge is locked by default (🔒 Locked) to prevent accidental cross-year entries. Click Unlock only when changing FY.',
      'In Staff Access Control, Master Admin sets every sheet to Blocked / View Only / Full Edit per employee.',
    ],
    stepsBn: [
      'অ্যাপ খোলার সাথে সাথে Google লগইন বা Staff PIN দিয়ে আনলক করুন।',
      'উপরের হেডারে Financial Year (যেমন FY 2026-27) ডিফল্টভাবে লক থাকে। কেবল বছর বদলাতে হলে 🔒 বাটনে ক্লিক করে আনলক করুন।',
      'Staff Access Control থেকে প্রতিটি কর্মচারীর জন্য আলাদা শীট অ্যাক্সেস (Blocked / View / Edit) সেট করা যায়।',
    ],
  },
  {
    id: 'fleet-alerts',
    badge: '2. Fleet & 15d Alerts',
    titleEn: 'Masters & 15-Day Advance Expiry Alerts (FTL + LOGISTICS)',
    titleBn: 'গাড়ি, ড্রাইভার ও ১৫ দিন আগের ডকুমেন্ট মেয়াদ অ্যালার্ট',
    stepsEn: [
      'Add Parties (with GSTIN, PAN, Phone), Lorry Owners, Brokers, Vehicles, and Drivers under Master Data.',
      'Vehicles automatically monitor 5 documents: Fitness, Insurance, Permit, Road Tax, and PUC.',
      'Red badge = Expired (<0 days). Amber badge = 15-Day Advance Alert (0–15 days remaining) visible in Header Bell & Dashboard.',
    ],
    stepsBn: [
      'Master Data-তে পার্টি (GSTIN, PAN), ট্রাক, ওনার, ব্রোকার ও ড্রাইভারের তথ্য সেভ রাখুন।',
      'প্রতিটি গাড়ির Fitness, Insurance, Permit, Road Tax ও PUC-এর মেয়াদ অটোমেটিক ট্র্যাক হয়।',
      'মেয়াদ শেষ হওয়ার ১৫ দিন আগে থেকেই ড্যাশবোর্ড ও বেল আইকনে হলুদ (15d Alert) এবং মেয়াদ পেরোলে লাল সতর্কবার্তা দেখাবে।',
    ],
  },
  {
    id: 'cn-ewb',
    badge: '3. CN / E-Way Bill',
    titleEn: 'Consignment Note (LR), Verification QR & E-Way Bill Part-B Tracker',
    titleBn: 'সি.এন / বিল্টি এন্ট্রি, কিউআর স্ক্যানার ও ই-ওয়ে বিল ট্র্যাকার',
    stepsEn: [
      'Select Division (FTL or LOGISTICS) right at the top of the CN form. Smart Auto-Fill populates GSTIN, address, driver, and last freight rate.',
      'Use Scan EWB QR to scan E-Way Bills directly with the device camera or USB barcode reader and fill Valid Upto date/time.',
      'Click Export Part-B JSON to download NIC vehicle update JSON, then click NIC E-Way Portal to upload directly.',
      'All 4 LR print copies carry the DRC Triangle Logo top-left, Verification QR + Company Stamp bottom-right.',
    ],
    stepsBn: [
      'নতুন CN বানানোর সময় FTL বা LOGISTICS ডিভিশন বেছে নিন। পার্টি বা গাড়ি সিলেক্ট করলেই GSTIN, ঠিকানা ও পুরনো ভাড়া অটোমেটিক বসে যাবে।',
      'Scan EWB QR দিয়ে ক্যামেরা বা স্ক্যানারের সাহায্যে ই-ওয়ে বিল নম্বর ও Valid Upto সময় স্ক্যান করুন।',
      'Export Part-B JSON বাটনে ক্লিক করে পার্ট-বি গাড়ি আপডেট ফাইল ডাউনলোড করুন এবং সরাসরি ই-ওয়ে বিল পোর্টালে আপলোড করুন।',
      'প্রিন্টের সব ৪টি কপিতেই DRC লোগো, Verification QR এবং স্ট্যাম্প-সাইন স্বয়ংক্রিয়ভাবে প্রিন্ট হয়।',
    ],
  },
  {
    id: 'billing-quote-194c',
    badge: '4. Billing, Quotes & 194C',
    titleEn: 'Tax Invoice QR, Guarantor Quotations (Email-Only) & 194C PAN Copy',
    titleBn: 'ট্যাক্স ইনভয়েস, গ্যারান্টার কোটেশন (ইমেইল-অনলি) ও ১৯৪সি ডিক্লারেশন',
    stepsEn: [
      'Tax Invoices print BOTH Bank Payment UPI QR and DRC Verification QR alongside Stamp/Signature and support 1–4 combined A4 copies + Annexure.',
      'Quotations include a dedicated Payment Responsible / Guarantor field and a bottom Acceptance Box valid ONLY via official email (NOT WhatsApp/SMS).',
      'Section 194C(6) Declarations embed the saved Proprietor PAN Card photo cleanly on the RIGHT side under Declarant Details (no bottom stamp).',
    ],
    stepsBn: [
      'ট্যাক্স ইনভয়েসে BANK UPI QR এবং VERIFY QR দুটোই একসাথে প্রিন্ট হয় এবং ১ থেকে ৪ কপি ও Annexure একই PDF-এ পাওয়া যায়।',
      'কোটেশন ফর্মে Payment Guarantor-এর নাম-ফোন দিন। নিচের Acceptance বক্সে স্পষ্ট লেখা থাকে যে কেবল অফিশিয়াল ইমেইলেই কোটেশন অনুমোদন গ্রহণযোগ্য (হোয়াটসঅ্যাপ/এসএমএস নয়)।',
      '১৯৪সি ডিক্লারেশনে প্রোপ্রাইটরের প্যান কার্ডের ছবি ডানদিকে DECLARANT DETAILS-এর নিচে অটো-অ্যাটাচ হয়।',
    ],
  },
  {
    id: 'pod-camera',
    badge: '5. Lorry Hire & POD Lock',
    titleEn: 'Lorry Hire Settlement, Multi-Advance & Camera POD Scanner Lock',
    titleBn: 'লরি ভাড়া, মাল্টি-অ্যাডভান্স ও ক্যামেরা POD পেমেন্ট লক',
    stepsEn: [
      'Balance Payment remains strictly Locked until a signed POD photo is captured/uploaded and POD Receive Date + Delivered Pkgs are verified.',
      'Use Capture POD with Camera inside Lorry Hire to take live photos; images compress automatically below 440KB JPEG.',
    ],
    stepsBn: [
      'স্বাক্ষরিত POD ছবি আপলোড ও তারিখ না দেওয়া পর্যন্ত লরির ব্যালেন্স পেমেন্ট লক থাকে।',
      'Capture POD with Camera বাটনে ক্লিক করে সরাসরি মোবাইল বা ল্যাপটপ ক্যামেরা দিয়ে POD তুলুন; এটি অটোমেটিক কমপ্রেস হয়ে সেভ হবে।',
    ],
  },
  {
    id: 'gst-bank-tally',
    badge: '6. GST Hub, Bank & DBF',
    titleEn: 'GST & RCM Filing Hub, Bank PNB TDS Matching & FoxPro .DBF Restore',
    titleBn: 'জিএসটি ফাইলিং হাব, ব্যাংক TDS ম্যাচিং ও পুরনো FoxPro .DBF রিস্টোর',
    stepsEn: [
      'Open Reports -> GST & RCM Filing Hub for Monthly + Division filters, GSTR-1/3B/CDNR tables, GST JSON/Excel export, and direct PMT-06/GST Portal links.',
      'Import PNB Excel statements in Bank Receipt Import to extract UPI/UTR/Cheque numbers, match invoices, and compute 194C TDS automatically.',
      'Backup / Restore supports 1-click Auto-Collect Old Data (.DBF folder + Bank Excel, ignoring scrap*.dbf) and encrypted Google Drive sync.',
    ],
    stepsBn: [
      'Reports -> GST & RCM Filing Hub থেকে মাসিক GSTR-1/3B JSON ও Excel ডাউনলোড এবং সরাসরি GST পোর্টাল ও PMT-06 চালান পেমেন্ট করা যায়।',
      'Bank Import-এ PNB এক্সেল আপলোড করলে UPI/UTR/Cheque নম্বর সহ বিল ম্যাচ ও ১৯৪সি TDS অটোমেটিক হিসাব হয়ে যাবে।',
      'Backup/Restore থেকে পুরনো FoxPro ডেটা ফোল্ডার (.dbf, scrap বাদে) ও গুগল ড্রাইভ ব্যাকআপ এক ক্লিকেই রিস্টোর করা যায়।',
    ],
  },
  {
    id: 'switch-off',
    badge: '7. Safe Shutdown',
    titleEn: 'Red "Switch Off / Exit App" Safe Shutdown Procedure',
    titleBn: 'লাল "Switch Off / Exit App" বাটন দিয়ে নিরাপদে অ্যাপ বন্ধ করা',
    stepsEn: [
      'Before closing at the end of the day, click the red "Switch Off / Exit App" button in the top-right header or bottom-left sidebar.',
      'It flushes any pending offline queue entries, clears temporary blob memory & browser scratch data, sets your presence offline, signs out cleanly, and closes listeners.',
    ],
    stepsBn: [
      'দিনের শেষে কাজ শেষ হলে উপরে ডানদিকে বা বাঁদিকের মেনুতে থাকা লাল "Switch Off / Exit App" বাটনে ক্লিক করুন।',
      'এটি বকেয়া ডেটা সিঙ্ক করে, টেম্পোরারি ক্যাশ পরিষ্কার করে, সব ব্যাকগ্রাউন্ড কানেকশন বন্ধ করে এবং নিরাপদে অ্যাপ লগ-আউট করে দেয়।',
    ],
  },
];

export const UserGuideModule: React.FC = () => {
  const [query, setQuery] = useState('');
  const [langMode, setLangMode] = useState<'both' | 'en' | 'bn'>('both');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return GUIDE_SECTIONS;
    return GUIDE_SECTIONS.filter((sec) =>
      `${sec.badge} ${sec.titleEn} ${sec.titleBn} ${sec.stepsEn.join(' ')} ${sec.stepsBn.join(' ')}`
        .toLowerCase()
        .includes(q)
    );
  }, [query]);

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-[#0D47A1] to-[#1E3A8A] rounded-xl p-5 text-white shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center">
              <BookOpen className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold tracking-wide">
                Dolphin Road Carriers ERP — User Guide (অপারেটিং বুক)
              </h2>
              <p className="text-xs text-blue-100">
                Complete Standard Operating Manual for FTL &amp; LOGISTICS Divisions · English &amp; বাংলা
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 bg-white/10 p-1 rounded-lg">
            {(
              [
                ['both', 'English + বাংলা'],
                ['en', 'English Only'],
                ['bn', 'বাংলা মাত্র'],
              ] as const
            ).map(([k, lbl]) => (
              <button
                key={k}
                type="button"
                onClick={() => setLangMode(k)}
                className={`px-2.5 py-1 rounded text-xs font-bold cursor-pointer ${
                  langMode === k ? 'bg-amber-400 text-slate-950' : 'text-blue-100 hover:bg-white/10'
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 relative max-w-xl">
          <Search className="w-4 h-4 text-blue-200 absolute left-3 top-2.5" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search operating manual / গাইড খুঁজুন (e.g., E-Way, POD, 194C, GST, Switch Off)..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-white text-slate-900 text-xs font-semibold placeholder:text-slate-400"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filtered.map((sec) => (
          <div key={sec.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="px-2.5 py-0.5 rounded bg-blue-50 border border-blue-200 text-blue-800 text-[11px] font-extrabold">
                {sec.badge}
              </span>
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
            </div>

            {langMode !== 'bn' && (
              <div className="space-y-1.5">
                <h3 className="text-sm font-extrabold text-slate-900">{sec.titleEn}</h3>
                <ul className="space-y-1 text-xs text-slate-700">
                  {sec.stepsEn.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {langMode !== 'en' && (
              <div className={`space-y-1.5 ${langMode === 'both' ? 'pt-2 border-t border-slate-100' : ''}`}>
                <h4 className="text-sm font-extrabold text-indigo-900">{sec.titleBn}</h4>
                <ul className="space-y-1 text-xs text-slate-700">
                  {sec.stepsBn.map((step, idx) => (
                    <li key={idx} className="flex items-start gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-blue-600 shrink-0 mt-0.5" />
                      <span>{step}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
