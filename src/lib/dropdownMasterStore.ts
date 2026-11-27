import { CompanySettings, DropdownMasterConfig } from '../types/erp';
import { saveSettingsDocument } from './firestoreStore';

export interface StateDistrictGroup {
  code: string;
  name: string;
  label: string;
  districts: string[];
}

export const ALL_INDIA_NON_LIQUID_GOODS: string[] = [
  'MS Steel Pipes & Tubes',
  'TMT Bars & Iron Rods',
  'Structural Steel & Plates',
  'HR / CR Steel Coils & Sheets',
  'Iron Ingots / Billets / Pig Iron',
  'Cement Bags (OPC/PPC)',
  'Fly Ash & Bricks',
  'Coal & Coke',
  'Hardware & Machinery Parts',
  'Electrical Transformers & Cables',
  'FMCG & Packaged Food',
  'Rice, Wheat & Food Grains',
  'Sugar, Flour & Spices (Bags)',
  'Tea Chests & Jute Bales',
  'Fertilizer & Agro Seeds',
  'Paper Rolls & Packaging Material',
  'Garments & Textiles',
  'Plastic Granules & PVC Pipes',
  'Auto Spare Parts & Tyres',
  'Electronics & Home Appliances',
  'Solar Panels, Batteries & Inverters',
  'Pharmaceuticals & Medical Boxes',
  'Plyboard, Timber & Furniture',
  'Aluminium Ingots & Extrusions',
  'Ceramic Tiles, Marbles & Sanitaryware',
  'Solid Industrial Chemicals (Bags/Drums)',
  'General Cargo / Sundry Goods',
];

export const ALL_INDIA_STATES_DISTRICTS: StateDistrictGroup[] = [
  {
    code: '19',
    name: 'West Bengal',
    label: '19 - West Bengal',
    districts: [
      'Kolkata',
      'Howrah',
      'Hooghly',
      'North 24 Parganas',
      'South 24 Parganas',
      'Purba Bardhaman',
      'Paschim Bardhaman',
      'Durgapur',
      'Asansol',
      'Siliguri',
      'Darjeeling',
      'Jalpaiguri',
      'Alipurduar',
      'Cooch Behar',
      'Malda',
      'Uttar Dinajpur (Raiganj)',
      'Dakshin Dinajpur',
      'Murshidabad',
      'Nadia',
      'Birbhum',
      'Bankura',
      'Purulia',
      'Purba Medinipur (Haldia)',
      'Paschim Medinipur',
      'Jhargram',
      'Kalimpong',
    ],
  },
  {
    code: '18',
    name: 'Assam',
    label: '18 - Assam',
    districts: [
      'Guwahati (Kamrup Metro)',
      'Kamrup',
      'Dibrugarh',
      'Tinsukia',
      'Jorhat',
      'Silchar (Cachar)',
      'Nagaon',
      'Tezpur (Sonitpur)',
      'Bongaigaon',
      'Barpeta',
      'Goalpara',
      'Dhubri',
      'Kokrajhar',
      'Sivasagar',
      'Lakhimpur',
      'Karimganj',
    ],
  },
  {
    code: '10',
    name: 'Bihar',
    label: '10 - Bihar',
    districts: [
      'Patna',
      'Gaya',
      'Muzaffarpur',
      'Bhagalpur',
      'Purnia',
      'Darbhanga',
      'Begusarai',
      'Katihar',
      'Araria',
      'Kishanganj',
      'Chapra (Saran)',
      'Hajipur (Vaishali)',
      'Motihari',
      'Bettiah',
      'Samastipur',
      'Munger',
      'Sasaram (Rohtas)',
    ],
  },
  {
    code: '20',
    name: 'Jharkhand',
    label: '20 - Jharkhand',
    districts: [
      'Ranchi',
      'Jamshedpur (East Singhbhum)',
      'Dhanbad',
      'Bokaro',
      'Hazaribagh',
      'Deoghar',
      'Giridih',
      'Ramgarh',
      'Chaibasa (West Singhbhum)',
      'Dumka',
      'Palamu (Daltonganj)',
      'Adityapur (Seraikela)',
    ],
  },
  {
    code: '21',
    name: 'Odisha',
    label: '21 - Odisha',
    districts: [
      'Bhubaneswar (Khordha)',
      'Cuttack',
      'Rourkela (Sundargarh)',
      'Sambalpur',
      'Berhampur (Ganjam)',
      'Balasore',
      'Bhadrak',
      'Jajpur (Kalinganagar)',
      'Angul',
      'Jharsuguda',
      'Paradip (Jagatsinghpur)',
      'Keonjhar',
      'Baripada (Mayurbhanj)',
    ],
  },
  {
    code: '33',
    name: 'Tamil Nadu',
    label: '33 - Tamil Nadu',
    districts: [
      'Chennai',
      'Coimbatore',
      'Madurai',
      'Tiruchirappalli',
      'Salem',
      'Tiruppur',
      'Erode',
      'Vellore',
      'Thoothukudi (Tuticorin)',
      'Hosur (Krishnagiri)',
      'Tirunelveli',
      'Thanjavur',
      'Kanchipuram',
    ],
  },
  {
    code: '09',
    name: 'Uttar Pradesh',
    label: '09 - Uttar Pradesh',
    districts: [
      'Lucknow',
      'Kanpur',
      'Varanasi',
      'Prayagraj',
      'Ghaziabad',
      'Noida (Gautam Buddha Nagar)',
      'Agra',
      'Meerut',
      'Gorakhpur',
      'Bareilly',
      'Aligarh',
      'Moradabad',
    ],
  },
  {
    code: '27',
    name: 'Maharashtra',
    label: '27 - Maharashtra',
    districts: [
      'Mumbai',
      'Pune',
      'Nagpur',
      'Thane',
      'Nashik',
      'Aurangabad',
      'Solapur',
      'Kolhapur',
      'Bhiwandi',
      'Raigad (Panvel)',
    ],
  },
  {
    code: '24',
    name: 'Gujarat',
    label: '24 - Gujarat',
    districts: [
      'Ahmedabad',
      'Surat',
      'Vadodara',
      'Rajkot',
      'Gandhidham (Kutch)',
      'Vapi (Valsad)',
      'Jamnagar',
      'Bhavnagar',
      'Ankleshwar (Bharuch)',
    ],
  },
  {
    code: '22',
    name: 'Chhattisgarh',
    label: '22 - Chhattisgarh',
    districts: ['Raipur', 'Bhilai (Durg)', 'Bilaspur', 'Korba', 'Raigarh', 'Rajnandgaon', 'Jagdalpur'],
  },
  {
    code: '07',
    name: 'Delhi NCR',
    label: '07 - Delhi NCR',
    districts: ['New Delhi', 'North Delhi', 'South Delhi', 'East Delhi', 'West Delhi', 'Gurugram', 'Faridabad'],
  },
  {
    code: '06',
    name: 'Haryana',
    label: '06 - Haryana',
    districts: ['Ambala', 'Panipat', 'Karnal', 'Hisar', 'Rohtak', 'Sonipat', 'Yamunanagar', 'Gurugram', 'Faridabad'],
  },
  {
    code: '03',
    name: 'Punjab',
    label: '03 - Punjab',
    districts: ['Ludhiana', 'Amritsar', 'Jalandhar', 'Patiala', 'Bathinda', 'Mohali', 'Mandi Gobindgarh'],
  },
  {
    code: '08',
    name: 'Rajasthan',
    label: '08 - Rajasthan',
    districts: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota', 'Bhiwadi (Alwar)', 'Ajmer', 'Bikaner'],
  },
  {
    code: '23',
    name: 'Madhya Pradesh',
    label: '23 - Madhya Pradesh',
    districts: ['Indore', 'Bhopal', 'Jabalpur', 'Gwalior', 'Ujjain', 'Satna', 'Singrauli'],
  },
  {
    code: '37',
    name: 'Andhra Pradesh',
    label: '37 - Andhra Pradesh',
    districts: ['Visakhapatnam', 'Vijayawada', 'Guntur', 'Nellore', 'Tirupati', 'Kakinada'],
  },
  {
    code: '36',
    name: 'Telangana',
    label: '36 - Telangana',
    districts: ['Hyderabad', 'Secunderabad', 'Warangal', 'Nizamabad', 'Karimnagar'],
  },
  {
    code: '29',
    name: 'Karnataka',
    label: '29 - Karnataka',
    districts: ['Bengaluru', 'Hubballi-Dharwad', 'Mangaluru', 'Belagavi', 'Mysuru', 'Ballari'],
  },
  {
    code: '32',
    name: 'Kerala',
    label: '32 - Kerala',
    districts: ['Kochi (Ernakulam)', 'Thiruvananthapuram', 'Kozhikode', 'Thrissur', 'Kollam'],
  },
  {
    code: '16',
    name: 'Tripura',
    label: '16 - Tripura',
    districts: ['Agartala', 'Udaipur', 'Dharmanagar'],
  },
  {
    code: '17',
    name: 'Meghalaya',
    label: '17 - Meghalaya',
    districts: ['Shillong', 'Byrnihat', 'Tura'],
  },
  {
    code: '14',
    name: 'Manipur',
    label: '14 - Manipur',
    districts: ['Imphal'],
  },
  {
    code: '13',
    name: 'Nagaland',
    label: '13 - Nagaland',
    districts: ['Dimapur', 'Kohima'],
  },
  {
    code: '12',
    name: 'Arunachal Pradesh',
    label: '12 - Arunachal Pradesh',
    districts: ['Itanagar', 'Naharlagun'],
  },
  {
    code: '15',
    name: 'Mizoram',
    label: '15 - Mizoram',
    districts: ['Aizawl'],
  },
  {
    code: '11',
    name: 'Sikkim',
    label: '11 - Sikkim',
    districts: ['Gangtok', 'Rangpo'],
  },
  {
    code: '05',
    name: 'Uttarakhand',
    label: '05 - Uttarakhand',
    districts: ['Dehradun', 'Haridwar', 'Rudrapur'],
  },
  {
    code: '02',
    name: 'Himachal Pradesh',
    label: '02 - Himachal Pradesh',
    districts: ['Baddi', 'Shimla', 'Solan'],
  },
  {
    code: '01',
    name: 'Jammu & Kashmir',
    label: '01 - Jammu & Kashmir',
    districts: ['Jammu', 'Srinagar'],
  },
  {
    code: '30',
    name: 'Goa',
    label: '30 - Goa',
    districts: ['Panaji (North Goa)', 'Vasco / Margao (South Goa)'],
  },
  {
    code: '04',
    name: 'Chandigarh',
    label: '04 - Chandigarh',
    districts: ['Chandigarh Industrial Area'],
  },
  {
    code: '26',
    name: 'Dadra & Nagar Haveli and Daman & Diu',
    label: '26 - Dadra & Nagar Haveli and Daman & Diu',
    districts: ['Silvassa', 'Daman', 'Diu'],
  },
  {
    code: '34',
    name: 'Puducherry',
    label: '34 - Puducherry',
    districts: ['Puducherry', 'Karaikal'],
  },
  {
    code: '35',
    name: 'Andaman & Nicobar Islands',
    label: '35 - Andaman & Nicobar Islands',
    districts: ['Port Blair'],
  },
  {
    code: '38',
    name: 'Ladakh',
    label: '38 - Ladakh',
    districts: ['Leh', 'Kargil'],
  },
  {
    code: '31',
    name: 'Lakshadweep',
    label: '31 - Lakshadweep',
    districts: ['Kavaratti'],
  },
  {
    code: '99',
    name: 'International (Nepal / Bangladesh / Bhutan)',
    label: '99 - International (Nepal / Bangladesh / Bhutan)',
    districts: [
      'Birgunj (Nepal)',
      'Biratnagar (Nepal)',
      'Kathmandu (Nepal)',
      'Kakarvitta (Nepal)',
      'Bhairahawa (Nepal)',
      'Benapole (Bangladesh)',
      'Petrapole Border',
      'Chittagong (Bangladesh)',
      'Dhaka (Bangladesh)',
      'Phuentsholing (Bhutan)',
      'Thimphu (Bhutan)',
      'Jaigaon Border',
    ],
  },
];

export const DEFAULT_PACKAGE_MODES: string[] = [
  'BAGS',
  'BALES',
  'BOXES',
  'BUNDLES',
  'COILS',
  'CRATES (WOODEN)',
  'DRUMS',
  'FTL (FULL TRUCK LOAD)',
  'INCH',
  'LOOSE',
  'METER',
  'MULTI',
  'NOS',
  'NUMBER',
  'PACKAGES',
  'PALLETS',
  'PART LOAD',
  'PIECES',
  'ROLLS',
  'SHEETS / PLATES',
  'TINS / CASES',
];

export const DEFAULT_RATE_MODES: string[] = [
  'Fixed Lorry Freight (Lump Sum)',
  'Per Bag / Sack',
  'Per Box / Carton',
  'Per Inch',
  'Per Kg',
  'Per Km',
  'Per Meter',
  'Per Nos / Piece',
  'Per Package / Box',
  'Per Quintal',
  'Per Ton / MT',
  'Per Trip',
];

export const DEFAULT_CREDIT_DAY_PRESETS: number[] = [10, 15, 20, 30, 45, 60];

export const DEFAULT_DELIVERY_PLACES: string[] = [
  'Kolkata (Dankuni / Dhulagarh)',
  'Siliguri (Fulbari / Sevoke Road)',
  'Cooch Behar',
  'Alipurduar',
  'Malda',
  'Raiganj',
  'Durgapur',
  'Asansol',
  'Haldia',
  'Guwahati (Assam)',
  'Tinsukia (Assam)',
  'Dibrugarh (Assam)',
  'Silchar (Assam)',
  'Patna (Bihar)',
  'Purnia (Bihar)',
  'Muzaffarpur (Bihar)',
  'Ranchi (Jharkhand)',
  'Jamshedpur (Jharkhand)',
  'Dhanbad (Jharkhand)',
  'Bhubaneswar (Odisha)',
  'Cuttack (Odisha)',
  'Rourkela (Odisha)',
  'Kalinganagar (Odisha)',
  'Raipur (Chhattisgarh)',
  'Delhi NCR',
  'Mumbai / Bhiwandi (Maharashtra)',
  'Ahmedabad (Gujarat)',
  'Chennai (Tamil Nadu)',
  'Coimbatore (Tamil Nadu)',
  'Bengaluru (Karnataka)',
  'Hyderabad (Telangana)',
  'Birgunj (Nepal)',
  'Biratnagar (Nepal)',
  'Kathmandu (Nepal)',
  'Benapole (Bangladesh)',
  'Dhaka (Bangladesh)',
  'Phuentsholing (Bhutan)',
];

export const DEFAULT_DELIVERY_LOCATIONS: string[] = DEFAULT_DELIVERY_PLACES;

export const DEFAULT_DELIVERY_TYPES: string[] = [
  'Door Delivery',
  'Godown Delivery',
  'Factory / Plant Gate Delivery',
  'Port / ICD Delivery',
  'Border / Export Crossing Delivery',
];

export function sortAlphaList(items: string[]): string[] {
  return [...items].sort((a, b) =>
    String(a).localeCompare(String(b), undefined, { sensitivity: 'base', numeric: true })
  );
}

export const COMMON_EXPENSE_HEAD_OPTIONS: string[] = sortAlphaList([
  'Bank Charges & Commission',
  'Broker Commission / Dalali',
  'Detention & Waiting Charges',
  'Diesel & Fuel Expense',
  'Driver Bata & Fooding',
  'GPS & Fastag Recharge',
  'Loading & Labour Charges (Hamali)',
  'Lorry Hire Advance / Balance',
  'Office Rent & Electricity',
  'Permit, Border & Checkpost Fee',
  'RTO, Fitness & Road Tax',
  'Salary & Staff Commission',
  'Telephone & Internet',
  'Toll & Highway Plaza',
  'Tyre, Spare Parts & Repair',
  'Unloading Charges',
  'Vehicle Insurance Premium',
]);

export const COMMON_REMARK_PRESETS: string[] = sortAlphaList([
  '100% Delivery Verified — No Shortage / No Damage',
  'Advance Paid Against Lorry Hire Challan',
  'Balance Locked Pending Signed POD Receipt',
  'Border / Export Crossing Clearance Included',
  'CGST + SGST Applied (Intra-State West Bengal)',
  'Consignee To Pay Basis (RCM Applicable)',
  'Credit Period 15 Days From Bill Submission',
  'Credit Period 30 Days From Bill Submission',
  'Detention Free 2 Days — Extra Per Day Thereafter',
  'Door Delivery Completed With Consignee Stamp',
  'Full & Final Settlement Received via NEFT/RTGS',
  'GST Exempt Export Movement (Nepal / Bangladesh / Bhutan)',
  'Handle With Care — Non-Liquid Dry Cargo',
  'IGST Applied (Interstate Movement Outside WB)',
  'Part Payment Received — Balance Due',
  'TDS Sec 194C Declaration Attached (0% Deduction)',
]);

export const PAYMENT_MODE_OPTIONS: string[] = sortAlphaList([
  'Adjustment',
  'Advance',
  'Bank Transfer',
  'Cash',
  'Cheque',
  'Diesel Slip',
  'IMPS',
  'NEFT',
  'RTGS',
  'UPI',
]);

export const DEFAULT_BANK_NAMES: string[] = sortAlphaList([
  'Axis Bank',
  'Bandhan Bank',
  'Bank of Baroda',
  'Bank of India',
  'Canara Bank',
  'Central Bank of India',
  'Federal Bank',
  'HDFC Bank',
  'ICICI Bank',
  'IDBI Bank',
  'Indian Bank',
  'IndusInd Bank',
  'Kotak Mahindra Bank',
  'Punjab & Sind Bank',
  'Punjab National Bank',
  'State Bank of India',
  'UCO Bank',
  'Union Bank of India',
  'Yes Bank',
]);

export const VEHICLE_MAKE_OPTIONS: string[] = sortAlphaList([
  'AMW (Asia Motor Works)',
  'Ashok Leyland',
  'Bajaj',
  'BharatBenz',
  'Eicher',
  'Force Motors',
  'Hino',
  'Isuzu',
  'Mahindra',
  'MAN',
  'Maruti Suzuki',
  'Piaggio',
  'Scania',
  'SML Isuzu',
  'Tata Motors',
  'Volvo',
]);

export const VEHICLE_BODY_TYPE_OPTIONS: string[] = [
  'Full Dala Body',
  'Half Dala Body',
  'Open Body',
  'Closed Container 20ft',
  'Closed Container 32ft',
  'Closed Container 40ft',
  'Flatbed Trailer',
  'Low-Bed Trailer',
  'Semi Low-Bed Trailer',
  'Skeleton Trailer',
  'Bulker / Tanker',
  'Tipper / Hyva',
  'Reefer Van',
  'LCV / Pickup',
  '6W',
  '10W',
  '12W',
  '14W',
  '16W',
  '18W',
  '22W',
];

export const VEHICLE_COLOR_OPTIONS: string[] = sortAlphaList([
  'Black',
  'Blue',
  'Brown',
  'Cream',
  'Golden',
  'Green',
  'Grey',
  'Maroon',
  'Multi-Color',
  'Orange / Saffron',
  'Red',
  'Silver',
  'White',
  'Yellow',
]);

export const ALL_INDIA_BRANCH_OPTIONS: string[] = sortAlphaList([
  'Asansol',
  'Dankuni',
  'Delhi NCR',
  'Durgapur',
  'Guwahati',
  'Haldia',
  'Howrah',
  'Jharkhand',
  'Kharagpur',
  'Kolkata',
  'Mumbai',
  'Patna',
  'Ranchi',
  'Siliguri',
  'Varanasi',
]);

export const DELIVERY_MODE_CODES = [
  { code: 'P', label: 'P = Party Delivery (Door)' },
  { code: 'G', label: 'G = Godown Delivery' },
  { code: 'D', label: 'D = Dock / Hub Delivery' },
] as const;

export const GST_PAID_BY_CODES = [
  { code: 'R', mapped: 'Consignor', label: 'R = Consignor (RCM)' },
  { code: 'E', mapped: 'Consignee', label: 'E = Consignee (RCM)' },
  { code: 'T', mapped: 'Transporter', label: 'T = Transporter (FCM)' },
] as const;

export const RISK_TYPE_CODES = [
  { code: 'O', label: "O = Owner's Risk" },
  { code: 'C', label: "C = Carrier's Risk" },
  { code: 'I', label: 'I = Insurance Risk' },
] as const;

export const BILL_REMARK_PRESETS: string[] = sortAlphaList([
  '100% Delivery Verified With Signed POD Attached',
  'Advance Received Deducted — Balance Payable',
  'Consignee To Pay Basis (GST Under RCM)',
  'Consignor To Pay Basis (GST Under RCM)',
  'Detention Beyond 48 Hrs Extra As Per Agreement',
  'Direct Door Delivery Completed On Time',
  'Export Freight Zero-Rated GST (Bangladesh / Nepal / Bhutan)',
  'Full Truck Load Freight Charges',
  'Loading & Unloading Extra At Actuals',
  'Part-Load / Parcel Consolidation Freight',
]);

export const BILL_FOOTNOTE_PRESETS: string[] = [
  'Terms: Subject to Kolkata Jurisdiction. Payment due within 15/30 days; 18% p.a. interest on delayed payment.',
  'RCM Note: GST on GTA Service is payable directly by the Recipient under Reverse Charge Notification 13/2017-CT(R).',
  'Export Exemption: International Freight up to Nepal / Bangladesh / Bhutan Border Exempt under SAC 9965/9967.',
  'TDS Exemption: Sec 194C Non-Deduction Declaration & PAN Copy (DOTPS3540M) attached with this Bill.',
];

export function mergeDropdownOptions(existing: string[], additions: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const raw of [...(existing || []), ...(additions || [])]) {
    const clean = String(raw || '').trim();
    if (!clean) continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }

  return sortAlphaList(result);
}

export type DropdownCategoryKey =
  | 'goodsTypes'
  | 'packageModes'
  | 'rateModes'
  | 'deliveryPlaces'
  | 'states'
  | 'bankNames'
  | 'paymentModes'
  | 'vehicleBodyTypes';

const CATEGORY_DEFAULTS: Record<DropdownCategoryKey, string[]> = {
  goodsTypes: ALL_INDIA_NON_LIQUID_GOODS,
  packageModes: DEFAULT_PACKAGE_MODES,
  rateModes: DEFAULT_RATE_MODES,
  deliveryPlaces: DEFAULT_DELIVERY_PLACES,
  states: ALL_INDIA_STATES_DISTRICTS.map((s) => s.label),
  bankNames: DEFAULT_BANK_NAMES,
  paymentModes: PAYMENT_MODE_OPTIONS,
  vehicleBodyTypes: VEHICLE_BODY_TYPE_OPTIONS,
};

export function getEffectiveDropdownList(
  company: CompanySettings,
  category: DropdownCategoryKey
): string[] {
  const custom = company.dropdownMaster?.[category];
  if (Array.isArray(custom)) {
    if (category === 'packageModes') {
      return mergeDropdownOptions(custom, ['MULTI', 'NOS', 'METER', 'LOOSE', 'BAGS', 'NUMBER', 'PACKAGES', 'PIECES', 'BOXES', 'BUNDLES', 'DRUMS', 'ROLLS', 'PALLETS', 'INCH']);
    }
    if (category === 'paymentModes') {
      return mergeDropdownOptions(PAYMENT_MODE_OPTIONS, custom);
    }
    return sortAlphaList(custom);
  }
  return sortAlphaList(CATEGORY_DEFAULTS[category]);
}

export function getEffectiveDistrictsForState(
  company: CompanySettings,
  stateLabel: string
): string[] {
  const trimmed = String(stateLabel || '').trim();
  const matchedRegion =
    ALL_INDIA_STATES_DISTRICTS.find(
      (s) =>
        s.label.toLowerCase() === trimmed.toLowerCase() ||
        s.name.toLowerCase() === trimmed.toLowerCase() ||
        s.code.toLowerCase() === trimmed.toLowerCase()
    ) ||
    (trimmed.length >= 3
      ? ALL_INDIA_STATES_DISTRICTS.find(
          (s) =>
            s.label.toLowerCase().includes(trimmed.toLowerCase()) ||
            trimmed.toLowerCase().includes(s.name.split('(')[0].trim().toLowerCase())
        )
      : undefined);
  const customMap = company.dropdownMaster?.districtsByState || {};
  const customExact =
    (trimmed && Array.isArray(customMap[trimmed]) && customMap[trimmed]) ||
    (matchedRegion?.label && Array.isArray(customMap[matchedRegion.label]) && customMap[matchedRegion.label]);
  if (customExact) {
    return sortAlphaList(customExact);
  }
  return matchedRegion
    ? sortAlphaList([...matchedRegion.districts])
    : sortAlphaList(ALL_INDIA_STATES_DISTRICTS.flatMap((s) => s.districts).slice(0, 60));
}

export function getEffectiveCreditDayPresets(company: CompanySettings): number[] {
  const custom = company.dropdownMaster?.creditDayPresets;
  const combined = Array.from(
    new Set([...DEFAULT_CREDIT_DAY_PRESETS, ...(custom || [])].filter((n) => n > 0))
  ).sort((a, b) => a - b);
  return combined.length > 0 ? combined : DEFAULT_CREDIT_DAY_PRESETS;
}

async function persistDropdownMaster(
  ownerUid: string,
  company: CompanySettings,
  nextMaster: DropdownMasterConfig
): Promise<void> {
  const payload: CompanySettings = {
    ...company,
    ownerUid: company.ownerUid || ownerUid,
    dropdownMaster: nextMaster,
  };
  await saveSettingsDocument(
    'company',
    payload as unknown as Record<string, unknown>,
    Boolean(company.ownerUid)
  );
}

export async function addDropdownItem(
  ownerUid: string,
  company: CompanySettings,
  category: DropdownCategoryKey,
  newValue: string
): Promise<void> {
  const clean = newValue.trim();
  if (!clean) return;
  const current = getEffectiveDropdownList(company, category);
  const updated = mergeDropdownOptions(current, [clean]);
  await persistDropdownMaster(ownerUid, company, {
    ...(company.dropdownMaster || {}),
    [category]: updated,
  });
}

export async function editDropdownItem(
  ownerUid: string,
  company: CompanySettings,
  category: DropdownCategoryKey,
  oldValue: string,
  newValue: string
): Promise<void> {
  const clean = newValue.trim();
  if (!clean) return;
  const current = getEffectiveDropdownList(company, category);
  const updated = current.map((item) => (item === oldValue ? clean : item));
  await persistDropdownMaster(ownerUid, company, {
    ...(company.dropdownMaster || {}),
    [category]: updated,
  });
}

export async function deleteDropdownItem(
  ownerUid: string,
  company: CompanySettings,
  category: DropdownCategoryKey,
  targetValue: string
): Promise<void> {
  const current = getEffectiveDropdownList(company, category);
  const updated = current.filter((item) => item !== targetValue);
  await persistDropdownMaster(ownerUid, company, {
    ...(company.dropdownMaster || {}),
    [category]: updated,
  });
}

export async function upsertDistrictItem(
  ownerUid: string,
  company: CompanySettings,
  stateLabel: string,
  action: { type: 'add'; value: string } | { type: 'edit'; oldValue: string; newValue: string } | { type: 'delete'; value: string }
): Promise<void> {
  const key = stateLabel.trim() || 'General';
  const current = getEffectiveDistrictsForState(company, key);
  let nextList = current;
  if (action.type === 'add') {
    const clean = action.value.trim();
    if (!clean) return;
    nextList = mergeDropdownOptions(current, [clean]);
  } else if (action.type === 'edit') {
    const clean = action.newValue.trim();
    if (!clean) return;
    nextList = current.map((d) => (d === action.oldValue ? clean : d));
  } else if (action.type === 'delete') {
    nextList = current.filter((d) => d !== action.value);
  }
  await persistDropdownMaster(ownerUid, company, {
    ...(company.dropdownMaster || {}),
    districtsByState: {
      ...(company.dropdownMaster?.districtsByState || {}),
      [key]: nextList,
    },
  });
}

export async function resetDropdownCategory(
  ownerUid: string,
  company: CompanySettings,
  category: DropdownCategoryKey
): Promise<void> {
  const next = { ...(company.dropdownMaster || {}) };
  delete next[category];
  await persistDropdownMaster(ownerUid, company, next);
}

export async function updateCreditDayPresets(
  ownerUid: string,
  company: CompanySettings,
  presets: number[]
): Promise<void> {
  const clean = Array.from(new Set(presets.map((n) => Math.round(Number(n))).filter((n) => n > 0 && n <= 365))).sort(
    (a, b) => a - b
  );
  await persistDropdownMaster(ownerUid, company, {
    ...(company.dropdownMaster || {}),
    creditDayPresets: clean,
  });
}

