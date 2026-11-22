import React, { useMemo, useState } from 'react';
import { BookOpen, CheckCircle2, CloudUpload, Eye, FileText, Printer, Search } from 'lucide-react';
import {
  AnyDriveFolderName,
  CompanySettings,
  DEFAULT_COMPANY_SETTINGS,
} from '../types/erp';
import {
  generateAppFormatBlueprintPDF,
  GeneratedPdfResult,
  generateOperatingBookPDF,
  OperatingBookPdfPart,
  printPdfDirect,
} from '../lib/pdfEngine';
import { uploadBlueprintPdfToDrive } from '../lib/driveBackup';
import { BACKUP_ISOLATED_DRIVE_EMAIL } from '../lib/firebase';
import { playAlertBeep, playVerifiedBeep } from '../lib/audioFeedback';

interface UserGuideModuleProps {
  company?: CompanySettings;
  driveAccessToken?: string | null;
  onConnectDrive?: () => Promise<void>;
  onPreviewPdf?: (pdf: GeneratedPdfResult, folder: AnyDriveFolderName) => void;
}

interface OperatingBookItem {
  en: string;
  bn: string;
}

interface OperatingBookPart {
  id: string;
  partNo: string;
  titleEn: string;
  titleBn: string;
  items: OperatingBookItem[];
}

const BENGALI_DIGITS = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];

function toBengaliNumber(n: number): string {
  return String(n)
    .split('')
    .map((ch) => {
      const idx = Number(ch);
      return Number.isInteger(idx) && ch >= '0' && ch <= '9' ? BENGALI_DIGITS[idx] : ch;
    })
    .join('');
}

const OPERATING_BOOK_PARTS: OperatingBookPart[] = [
  {
    id: 'part-1',
    partNo: 'PART 1',
    titleEn: 'LOGIN, DUAL DEITIES HEADER, 4-BUSINESS SWITCHER & NAVIGATION',
    titleBn: 'লগইন, দ্বৈত প্রণাম, ৪-ব্যবসা সুইচার ও সহজ ন্যাভিগেশন',
    items: [
      {
        en: 'Sign in with Master Admin ID & Password or Staff Code & PIN. The Financial Year badge (FY 2026-27) starts Locked by default so older year books stay protected from accidental edits.',
        bn: 'Master Admin আইডি-পাসওয়ার্ড বা Staff Code ও PIN দিয়ে লগইন করুন। উপরের Financial Year ব্যাজ ডিফল্টভাবে লক থাকে যাতে ভুল করে অন্য বছরের খাতায় এন্ট্রি না হয়।',
      },
      {
        en: 'Use the 4 top switcher buttons [FTL], [LOGISTICS], [PTL], and [COURIER] to switch immediately between divisions, with Bhole Baba & Khatu Shyam Ji darshan visible in the header across Windows, Android, and Tablet.',
        bn: 'উপরে থাকা ৪টি সুইচার বাটন [FTL], [LOGISTICS], [PTL] এবং [COURIER] দিয়ে এক ক্লিকে ব্যবসা বদলান; Windows, Android ও Tablet-এ উপরের ডানদিকে ভোলে বাবা ও খাটু শ্যাম জি-র ছবি দেখা যাবে।',
      },
      {
        en: 'Every sheet shows a bright "<- Back" bar at the top that returns strictly to the current business dashboard without resetting your workspace. Mobile and tablet auto-rotate works smoothly in Portrait & Landscape.',
        bn: 'প্রতিটি ফর্মের উপরে উজ্জ্বল "<- Back" বার থাকে যা সরাসরি সেই ব্যবসার ড্যাশবোর্ডে ফিরিয়ে আনে। মোবাইল ও ট্যাবলেটে ল্যান্ডস্কেপ ও পোর্ট্রেট অটো-রোটেট সম্পূর্ণ সাপোর্ট করে।',
      },
      {
        en: 'Use FoxPro Keyboard Shortcuts inside Bilty & Billing sheets: F2 or Ctrl+S saves immediately, Alt+M or [M] toggles Multi-Lorry/Multi-Weight mode, and Esc safely closes preview modals.',
        bn: 'বিল্টি ও বিলিং ফর্মে FoxPro শর্টকাট ব্যবহার করুন: F2 বা Ctrl+S দিয়ে দ্রুত সেভ, Alt+M দিয়ে মাল্টি-লরি/মাল্টি-ওজন চালু এবং Esc চেপে প্রিভিউ বন্ধ করুন।',
      },
      {
        en: 'Startup Auto-Formula Health Guard runs automatically on every launch and on the 1st of every month to scan GST, RCM, TDS 194C, paise decimals, and trial balances.',
        bn: 'অ্যাপ খোলার সাথে সাথে এবং প্রতি মাসের ১ তারিখে Startup Formula Health Guard সব GST, RCM, TDS 194C ও টাকার পয়সার হিসাব অটো-চেক করে।',
      },
    ],
  },
  {
    id: 'part-2',
    partNo: 'PART 2',
    titleEn: 'UNIFIED BILTY & LORRY MASTER SHEET + E-WAY 8-HOUR COUNTDOWN ALARM',
    titleBn: 'ইউনিফায়েড বিল্টি ও লরি মাস্টার শীট + ই-ওয়ে ৮-ঘণ্টা কাউন্টডাউন অ্যালার্ম',
    items: [
      {
        en: 'Fill CN / Bilty Entry at the top (with Consignor, Consignee, Billed At Branch, Vehicle Toggle [Yes/No], Multi-Lorry, Multi-Goods, Multi-Weight & 2-Day Free Detention) and Lorry Hire, Broker & PAY 1-12 installments in the lower bands of the same sheet.',
        bn: 'উপরে CN / বিল্টি এন্ট্রি (Billed At ব্রাঞ্চ, Vehicle Yes/No, Multi-Lorry, মাল্টি-ওজন ও ২-দিন ফ্রি ডিটেনশন সহ) এবং নিচে Lorry Hire, Broker, Staff ও PAY ১-১২ কিস্তি একই শীটে একসঙ্গে পূরণ করুন।',
      },
      {
        en: 'Click "Scan EWB QR / Photo OCR" to read NIC E-Way Bill QR codes or lorry documents directly via camera/file and auto-fill EWB No, Valid Upto date/time, consignor/consignee details, and freight alerts.',
        bn: '"Scan EWB QR / Photo OCR" বাটনে ক্লিক করে ক্যামেরা বা ছবি থেকে E-Way Bill QR ও কাগজ স্ক্যান করলে EWB নম্বর, মেয়াদ এবং পার্টি তথ্য অটোমেটিক বসে যাবে।',
      },
      {
        en: 'Click "[ Phone Alarm ]" in the top bar once to enable background mobile/PC alerts: when an active E-Way Bill enters its final 8 hours down to 1 hour, continuous expiry countdown alarms alert your team until Unloading Date or Delivered POD is saved.',
        bn: 'উপরে থাকা "[ Phone Alarm ]" বাটনে একবার ক্লিক করে অ্যালার্ম চালু রাখুন: কোনো E-Way Bill শেষ ৮ ঘণ্টা থেকে ১ ঘণ্টার মধ্যে এলে আনলোডিং বা ডেলিভার্ড POD সেভ না হওয়া পর্যন্ত অ্যালার্ম বাজতে থাকবে।',
      },
      {
        en: 'Lorry Hire Balance Payment remains safely locked until POD photo scan, POD Receive Date, and Delivered Packages verification are saved. Shortage, breakage, or leakage triggers an instant alert beep.',
        bn: 'স্বাক্ষরিত POD ছবি, প্রাপ্তির তারিখ এবং ডেলিভার্ড প্যাকেজ যাচাই না হওয়া পর্যন্ত লরির ব্যালেন্স পেমেন্ট নিরাপদভাবে লক থাকে; মাল শর্ট বা ভাঙা থাকলে অ্যালার্ট বিপ বাজে।',
      },
      {
        en: 'Save any sheet with Verified Beep feedback and export clean low-KB A4 4-Copy LR PDFs (DRC Triangle Logo, Verification QR, and Proprietor Stamp) directly from the Entry Register below.',
        bn: 'যেকোনো এন্ট্রি সেভ করলেই ভেরিফাইড বিপ শোনা যাবে এবং নিচের Entry Register থেকে সরাসরি কম-MB-র A4 ৪-কপি LR PDF প্রিন্ট বা প্রিভিউ করা যাবে।',
      },
    ],
  },
  {
    id: 'part-3',
    partNo: 'PART 3',
    titleEn: 'PARTY TAX INVOICE, OFFICIAL GSTIN CHECKSUM VALIDATOR & 194C',
    titleBn: 'পার্টি ট্যাক্স ইনভয়েস, ১৫-অক্ষর GSTIN চেকসাম ভ্যালিডেটর ও ১৯৪সি',
    items: [
      {
        en: 'Every GSTIN input across Parties, Consignor/Consignee, and Billing verifies the official 15-character mathematical checksum live and blocks wrong check-digits with a red alert + warning beep, plus a "[ Verify GST Online ]" lookup button.',
        bn: 'পার্টি, কনসাইনর ও বিলিং-এর প্রতিটি GSTIN বক্সে ১৫-অক্ষরের সরকারি গাণিতিক চেকসাম অটোমেটিক যাচাই হয়; ভুল নম্বর দিলে লাল সতর্কবার্তা ও বিপ বাজে এবং "[ Verify GST Online ]" বাটনে পোর্টাল খোলা যায়।',
      },
      {
        en: 'The "Bill To Party *" picker lists strictly Customer / Consignor Billing Parties (never Brokers, Lorry Owners, or Drivers) with GSTIN, full address, and State Code auto-filled plus an instant Selected Party Preview Card.',
        bn: '"Bill To Party *" ড্রপডাউনে কেবল কাস্টমার/বিলিং পার্টি দেখা যায় (ব্রোকার, লরি মালিক বা ড্রাইভার নয়); সিলেক্ট করলেই GSTIN, ঠিকানা ও প্রিভিউ কার্ড সঙ্গে সঙ্গে চলে আসে।',
      },
      {
        en: 'Select GST mode (5% RCM Consignee/Consignor, 12% Forward Charge, or 0% Export for Nepal/Bangladesh/Bhutan), add pending CNs/dockets with Detention or Extra Charges, and lock final bills cleanly.',
        bn: '৫% RCM, ১২% ফরওয়ার্ড চার্জ বা ০% এক্সপোর্ট (নেপাল/বাংলাদেশ/ভুটান) বেছে নিয়ে পেন্ডিং CN বা ডকেট যোগ করুন এবং নিরাপদভাবে বিল ফাইনাল করুন।',
      },
      {
        en: 'Every Tax Invoice prints both Bank UPI Payment QR and DRC Verification QR, supports 1-4 copies + Multi-Lorry Annexure, and locks editing once finalized—only Master Admin PIN Credit Note unlocks a billed LR for Re-Bill.',
        bn: 'প্রতিটি ট্যাক্স ইনভয়েসে Bank UPI QR ও Verification QR একসাথে প্রিন্ট হয়; ফাইনাল বিল লক থাকে এবং কেবল Master Admin PIN-যুক্ত Credit Note দিলে তবেই সেই LR আবার বিল (Re-Bill) করার জন্য খোলে।',
      },
      {
        en: 'Generate Section 194C(6) Declarations (with PAN photo embedded under Declarant Details) and 10-Second Rate Quotations featuring Payment Guarantor & official Party Contact Email (drc.kolkata1@gmail.com) clause.',
        bn: '১৯৪সি(৬) ডিক্লারেশন (ডানদিকে প্যান কার্ডের ছবি সহ) এবং পেমেন্ট গ্যারান্টার ও অফিশিয়াল ইমেইল (drc.kolkata1@gmail.com) সহ ১০-সেকেন্ড কোটেশন তৈরি ও প্রিন্ট করুন।',
      },
    ],
  },
  {
    id: 'part-4',
    partNo: 'PART 4',
    titleEn: 'MASTERS PICKERS, STAFF PERMISSIONS MATRIX & BANK SMS READER',
    titleBn: 'মাস্টার্স পিকার, স্টাফ পারমিশন ম্যাট্রিক্স ও ব্যাংক SMS রিডার',
    items: [
      {
        en: 'All 5 Masters tabs (Parties & Ledgers, Lorry Owners, Brokers, Lorry Register, Drivers & KYC) include an instant top Dropdown + Search picker showing Name, GSTIN/PAN/Truck/DL No, City & Phone so duplicate names like two "RAM" entries never get mixed up.',
        bn: 'Masters-এর ৫টি ট্যাবেই (পার্টি, লরি ওনার, ব্রোকার, গাড়ি, ড্রাইভার) উপরে সার্চেবল ড্রপডাউন আছে যেখানে নাম, GSTIN/PAN/ট্রাক/DL ও ফোন দেখা যায়—ফলে এক নামের দুজন কখনো গুলিয়ে যাবে না।',
      },
      {
        en: 'Selecting any Party inside Masters opens its Tally-Grade running Debit/Credit Ledger and 1-click Low-MB Ledger PDF print; "Clean / Separate Brokers" removes misclassified non-customer records cleanly.',
        bn: 'Masters থেকে যেকোনো পার্টি সিলেক্ট করলেই তার Tally-ধাঁচের ডেবিট/ক্রেডিট লেজার ও ১-ক্লিক PDF প্রিন্ট পাওয়া যায় এবং "Clean / Separate Brokers" বাটনে ভুল ব্রোকার এন্ট্রি আলাদা করা যায়।',
      },
      {
        en: 'Control Staff Sheet Access (Full Edit, View-Only, or Blocked) per staff login from Staff Access Control inside the Sidebar, and track Wheeler commissions and monthly zero-settlements inside Staff Ledger.',
        bn: 'সাইডবারের Staff Access Control থেকে প্রতিটি কর্মচারীর জন্য আলাদা শীট পারমিশন (Full Edit / View-Only / Blocked) ঠিক করুন এবং Staff Ledger-এ চাকা অনুযায়ী কমিশন হিসাব রাখুন।',
      },
      {
        en: 'Paste any bank credit SMS/Email alert (or upload PNB/Bank Excel/CSV) in Bank Credit Reader to auto-extract Date, Paise Amount, NEFT/RTGS/IMPS/UPI UTR, auto-create the Receipt Voucher, and update Party & Invoice balances.',
        bn: 'Bank Credit Reader-এ ব্যাংকের SMS/ইমেইল অ্যালার্ট পেস্ট করলে (বা Excel/CSV আপলোড করলে) তারিখ, পয়সা সহ টাকা ও UTR অটো-পড়ে Receipt ভাউচার তৈরি হয় ও পার্টি লেজার আপডেট হয়ে যায়।',
      },
    ],
  },
  {
    id: 'part-5',
    partNo: 'PART 5',
    titleEn: 'GST SELF-FILING HUB, ANNUAL AUDITOR PACK & PIN-LOCK KYC VAULT',
    titleBn: 'জিএসটি ফাইলিং হাব, অ্যানুয়াল অডিটর প্যাক ও পিন-লক KYC ভল্ট',
    items: [
      {
        en: 'View monthly GSTR-1, GSTR-3B (with Purchase ITC), and CDNR across All 4 Businesses Combined or each business separately—calculated strictly from Billed Invoices + Purchase Vouchers without mixing lorry register data.',
        bn: 'GST হাব থেকে ৪টি ব্যবসা একসাথে বা আলাদাভাবে GSTR-1, GSTR-3B (Purchase ITC সহ) ও CDNR দেখুন—এটি কেবল বিল করা ইনভয়েস ও পারচেজ ভাউচার থেকে হিসাব হয়।',
      },
      {
        en: 'Automatic Beep, Desktop & Mobile Background Alarms fire starting on the 7th & 8th (GSTR-1 due 11th) and 15th (GSTR-3B due 20th) of every month, plus 10 / 5 / 2-day pre-expiry alerts for Vehicle & Statutory documents.',
        bn: 'প্রতি মাসের ৭-৮ তারিখ থেকে GSTR-1 (শেষ তারিখ ১১) এবং ১৫ তারিখ থেকে GSTR-3B (শেষ তারিখ ২০)-র অ্যালার্ম বিপ ও ফোন নোটিফিকেশন বাজে; এছাড়া গাড়ি ও লাইসেন্স মেয়াদের ১০, ৫ ও ২ দিন আগে সতর্কবার্তা দেখা যায়।',
      },
      {
        en: 'Use the 1-Click Annual Auditor & ITR Pack to select required ledgers, auto-print clean A4 statements, export multi-sheet Excel, and save DRC_GST_RETURNS.pdf & DRC_IT_RETURN_AUDIT.pdf directly to Google Drive.',
        bn: 'Annual Auditor & ITR Pack থেকে দরকারি লেজার বেছে অটো-প্রিন্ট, এক্সেল এক্সপোর্ট এবং DRC_GST_RETURNS.pdf ও DRC_IT_RETURN_AUDIT.pdf সরাসরি গুগল ড্রাইভে সেভ করুন।',
      },
      {
        en: 'Unlock the PIN-Protected Statutory & KYC Vault with Master Admin PIN to store WB Trade License (silpasathi.wb.gov.in), WB P-Tax (wbcomtax.gov.in), Udyam, GST, PAN, Aadhaar & Vehicle Papers and upload DRC_TRADE_LICENSE_PTAX.pdf & DRC_KYC_VAULT.pdf.',
        bn: 'Master Admin PIN দিয়ে Statutory & KYC ভল্ট খুলে WB Trade License, P-Tax, Udyam, GST, PAN, Aadhaar ও গাড়ির কাগজ স্ক্যান সহ সেভ করুন এবং DRC_TRADE_LICENSE_PTAX.pdf ও DRC_KYC_VAULT.pdf ড্রাইভে রাখুন।',
      },
    ],
  },
  {
    id: 'part-6',
    partNo: 'PART 6',
    titleEn: 'ANTI-SCREENSHOT SHIELD, 2-WAY SYNC, ISOLATED DRIVE SANDBOX & BLUEPRINT PDF',
    titleBn: 'অ্যান্টি-স্ক্রিনশট শিল্ড, ২-ওয়ে সিঙ্ক, আইসোলেটেড ড্রাইভ ও ব্লুপ্রিন্ট PDF',
    items: [
      {
        en: 'Anti-Screenshot & Privacy Shield automatically blocks PrintScreen, Win+Shift+S, screen recording, and right-click copy—covering the screen with a black Security Curtain + warning beep and showing a staff ID watermark for operator logins (Admin PIN grants 5-min unlock if needed).',
        bn: 'Anti-Screenshot শিল্ড অটোমেটিক PrintScreen, Win+Shift+S, স্ক্রিন রেকর্ডিং ও কপি ব্লক করে কালো পর্দা ও সতর্ক বিপ দেখায় এবং কর্মচারী লগইনে ওয়াটারমার্ক দেখায় (দরকারে Admin PIN দিয়ে ৫ মিনিটের জন্য খোলা যায়)।',
      },
      {
        en: 'Data never auto-deletes: the permanent No-Auto-Delete Shield protects all live Party, Invoice, Bilty, Lorry Hire & Voucher ledgers while 2-Way Timestamp Sync merges Windows, Tablet, and Android edits automatically without overwriting newer work.',
        bn: 'লাইভ ডেটা কখনো অটো-ডিলিট হয় না: স্থায়ী No-Auto-Delete শিল্ড সব বিল, বিল্টি ও লেজার রক্ষা করে এবং ২-ওয়ে টাইমস্ট্যাম্প সিঙ্ক Windows ও Android-এর নতুন এন্ট্রি নির্ভুলভাবে একসঙ্গে জুড়ে দেয়।',
      },
      {
        en: 'Dedicated Isolated App Backup Drive (drc.kolkata2015@gmail.com) uses strict app-only permissions (drive.file + hidden appDataFolder) separately from official party email (drc.kolkata1@gmail.com), and supports 1-click FoxPro .DBF migration.',
        bn: 'ব্যাকআপের জন্য আলাদা ইমেইল (drc.kolkata2015@gmail.com) শুধু অ্যাপের ফোল্ডারেই কাজ করে (পার্টি ইমেইল drc.kolkata1@gmail.com থেকে সম্পূর্ণ আলাদা) এবং এক ক্লিকে FoxPro .DBF ডেটা ইমপোর্ট করা যায়।',
      },
      {
        en: 'Click "3-Page App Blueprint PDF" above to preview, print, or upload compact DRC_APP_FORMAT_BLUEPRINT.pdf (complete workflow diagram, GST rules & disaster recovery handbook), and click red "Switch Off / Exit App" before closing.',
        bn: 'উপরের "3-Page App Blueprint PDF" বাটনে ক্লিক করে সম্পূর্ণ DRC_APP_FORMAT_BLUEPRINT.pdf প্রিভিউ/ড্রাইভ সেভ করুন এবং দিনের শেষে লাল "Switch Off / Exit App" চেপে নিরাপদভাবে অ্যাপ লক করুন।',
      },
    ],
  },
];

export const UserGuideModule: React.FC<UserGuideModuleProps> = ({
  company,
  driveAccessToken,
  onConnectDrive,
  onPreviewPdf,
}) => {
  const [query, setQuery] = useState('');
  const [printingPdf, setPrintingPdf] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const activeCompany: CompanySettings = useMemo(
    () => ({
      ...DEFAULT_COMPANY_SETTINGS,
      ownerUid: company?.ownerUid || 'drc_master_workspace',
      ...(company || {}),
    }),
    [company]
  );

  const filteredParts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return OPERATING_BOOK_PARTS;
    return OPERATING_BOOK_PARTS.map((part) => {
      const partMatches = `${part.partNo} ${part.titleEn} ${part.titleBn}`
        .toLowerCase()
        .includes(q);
      if (partMatches) return part;
      const matchedItems = part.items.filter((it) =>
        `${it.en} ${it.bn}`.toLowerCase().includes(q)
      );
      return matchedItems.length > 0 ? { ...part, items: matchedItems } : null;
    }).filter((p): p is OperatingBookPart => p !== null);
  }, [query]);

  const handlePrintOrPreviewBook = async (mode: 'print' | 'preview') => {
    try {
      setErrorMessage('');
      setPrintingPdf(true);
      const pdfParts: OperatingBookPdfPart[] = OPERATING_BOOK_PARTS.map((part) => ({
        partTitle: `${part.partNo}: ${part.titleEn}`,
        subtitle: part.titleBn,
        items: part.items.map((item, idx) => ({
          numEn: `${idx + 1}.`,
          en: item.en,
          numBn: `${toBengaliNumber(idx + 1)}.`,
          bn: item.bn,
        })),
      }));

      const pdf = await generateOperatingBookPDF({
        bookTitle: 'COMPLETE BILINGUAL OPERATING BOOK (অপারেটিং বুক — ENGLISH + বাংলা)',
        company: activeCompany,
        parts: pdfParts,
        fileName: 'DRC_Complete_Operating_Book_English_Bengali.pdf',
      });

      playVerifiedBeep();
      if (mode === 'print') {
        printPdfDirect(pdf);
        setStatusMessage('Complete Bilingual Operating Book sent to printer (Low-KB A4 PDF).');
      } else if (onPreviewPdf) {
        onPreviewPdf(pdf, 'Reports_Ledgers');
      } else {
        printPdfDirect(pdf);
      }
    } finally {
      setPrintingPdf(false);
    }
  };

  const handleBlueprintAction = async (mode: 'preview' | 'drive') => {
    try {
      setErrorMessage('');
      setPrintingPdf(true);
      const pdf = await generateAppFormatBlueprintPDF(activeCompany, 'p');
      if (mode === 'preview') {
        playVerifiedBeep();
        if (onPreviewPdf) {
          onPreviewPdf(pdf, 'Reports_Ledgers');
        } else {
          printPdfDirect(pdf);
        }
        setStatusMessage(`Generated 3-Page DRC_APP_FORMAT_BLUEPRINT.pdf (${pdf.sizeKB} KB).`);
        return;
      }

      if (!driveAccessToken) {
        if (onConnectDrive) {
          await onConnectDrive();
          setStatusMessage('Google Drive connected! Click "Save Blueprint to Drive" once more to upload DRC_APP_FORMAT_BLUEPRINT.pdf.');
        } else {
          playAlertBeep();
          setErrorMessage('Connect Google Drive in Backup / Cloud Sync first.');
        }
        return;
      }

      await uploadBlueprintPdfToDrive(driveAccessToken, pdf.blob);
      playVerifiedBeep();
      setStatusMessage(
        `Saved DRC_APP_FORMAT_BLUEPRINT.pdf (${pdf.sizeKB} KB) to Drive Reports_Ledgers + Hidden AppData Sandbox (${BACKUP_ISOLATED_DRIVE_EMAIL}).`
      );
    } catch (err) {
      playAlertBeep();
      setErrorMessage(err instanceof Error ? err.message : 'Failed to build DRC_APP_FORMAT_BLUEPRINT.pdf');
    } finally {
      setPrintingPdf(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header Hero */}
      <div className="bg-gradient-to-r from-[#0D47A1] to-[#1E3A8A] rounded-xl p-5 text-white shadow-md space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
              <BookOpen className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold tracking-wide">
                Dolphin Road Carriers ERP — Complete Operating Book (অপারেটিং বুক)
              </h2>
              <p className="text-xs text-blue-100">
                Single Part-by-Part Bilingual Manual (English + বাংলা Line-by-Line) · FTL, LOGISTICS, PTL &amp; COURIER
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={printingPdf}
              onClick={() => void handleBlueprintAction('preview')}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-indigo-500/80 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer border border-indigo-300/40"
            >
              <FileText className="w-4 h-4" />
              3-Page App Blueprint PDF
            </button>
            <button
              type="button"
              disabled={printingPdf}
              onClick={() => void handleBlueprintAction('drive')}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer"
            >
              <CloudUpload className="w-4 h-4" />
              {driveAccessToken ? 'Save Blueprint to Drive' : 'Connect Drive & Save Blueprint'}
            </button>
            {onPreviewPdf && (
              <button
                type="button"
                disabled={printingPdf}
                onClick={() => void handlePrintOrPreviewBook('preview')}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-white/15 hover:bg-white/25 disabled:opacity-60 text-white text-xs font-extrabold cursor-pointer"
              >
                <Eye className="w-4 h-4" />
                Preview Book PDF
              </button>
            )}
            <button
              type="button"
              disabled={printingPdf}
              onClick={() => void handlePrintOrPreviewBook('print')}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-slate-950 text-xs font-extrabold shadow cursor-pointer"
            >
              <Printer className="w-4 h-4" />
              {printingPdf ? 'Building PDF...' : 'Print Operating Book (A4 PDF)'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[260px] max-w-xl">
            <Search className="w-4 h-4 text-blue-200 absolute left-3 top-2.5" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search Operating Book / অপারেটিং বুক খুঁজুন (e.g., Bilty, E-Way, 194C, GSTIN, Blueprint, Shield)..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-white text-slate-900 text-xs font-semibold placeholder:text-slate-400"
            />
          </div>
          {statusMessage && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-300/40 text-emerald-100 text-xs font-bold">
              <CheckCircle2 className="w-4 h-4" />
              {statusMessage}
            </div>
          )}
          {errorMessage && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-500/30 border border-red-300/50 text-red-100 text-xs font-bold">
              {errorMessage}
            </div>
          )}
        </div>
      </div>

      {/* Single Continuous Part-by-Part Operating Book */}
      <div className="space-y-4">
        {filteredParts.map((part) => (
          <section
            key={part.id}
            className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden"
          >
            {/* Bold Part Header */}
            <div className="bg-gradient-to-r from-slate-900 to-blue-950 px-5 py-3 text-white flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-xs font-black tracking-wider text-amber-300 uppercase">
                  {part.partNo}
                </div>
                <h3 className="text-sm md:text-base font-extrabold tracking-wide">
                  {part.titleEn}
                </h3>
              </div>
              <div className="text-xs md:text-sm font-bold text-emerald-300">
                {part.titleBn}
              </div>
            </div>

            {/* Stacked Bilingual Numbered Points ("1. [EN]" right above "১. [BN]") */}
            <div className="divide-y divide-slate-100">
              {part.items.map((item, idx) => {
                const numEn = `${idx + 1}.`;
                const numBn = `${toBengaliNumber(idx + 1)}.`;
                return (
                  <div key={idx} className="p-4 hover:bg-slate-50/70 space-y-1.5">
                    <p className="text-xs md:text-sm font-bold text-slate-900 leading-relaxed">
                      <span className="inline-block min-w-[24px] text-blue-800 font-black">
                        {numEn}
                      </span>{' '}
                      {item.en}
                    </p>
                    <p className="text-xs md:text-sm font-semibold text-emerald-900 leading-relaxed">
                      <span className="inline-block min-w-[24px] text-emerald-700 font-black">
                        {numBn}
                      </span>{' '}
                      {item.bn}
                    </p>
                  </div>
                );
              })}
            </div>
          </section>
        ))}

        {filteredParts.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-xs text-slate-500 font-semibold">
            No matching Operating Book steps found for "{query}". Clear the search box to view all 6 Parts.
          </div>
        )}
      </div>
    </div>
  );
};
