export interface StateDistrictEntry {
  code: string;
  name: string;
  label: string;
  districts: string[];
}

export const ALL_INDIA_STATES_DISTRICTS: StateDistrictEntry[] = new Array(
  {
    code: "WB",
    name: "West Bengal",
    label: "19 - West Bengal",
    districts: new Array("Kolkata", "Howrah", "Hooghly", "North 24 Parganas", "South 24 Parganas", "Purba Bardhaman", "Paschim Bardhaman", "Siliguri", "Durgapur", "Asansol", "Malda", "Murshidabad", "Nadia", "Purba Medinipur", "Paschim Medinipur")
  },
  {
    code: "MH",
    name: "Maharashtra",
    label: "27 - Maharashtra",
    districts: new Array("Mumbai", "Pune", "Nagpur", "Thane", "Nashik", "Aurangabad", "Solapur", "Kolhapur", "Bhiwandi")
  },
  {
    code: "DL",
    name: "Delhi",
    label: "07 - Delhi",
    districts: new Array("New Delhi", "North Delhi", "South Delhi", "East Delhi", "West Delhi")
  },
  {
    code: "GJ",
    name: "Gujarat",
    label: "24 - Gujarat",
    districts: new Array("Ahmedabad", "Surat", "Vadodara", "Rajkot", "Vapi", "Ankleshwar", "Gandhidham")
  },
  {
    code: "TN",
    name: "Tamil Nadu",
    label: "33 - Tamil Nadu",
    districts: new Array("Chennai", "Coimbatore", "Madurai", "Salem", "Tiruchirappalli", "Hosur")
  },
  {
    code: "KA",
    name: "Karnataka",
    label: "29 - Karnataka",
    districts: new Array("Bengaluru", "Mysuru", "Hubballi", "Mangaluru", "Belagavi")
  },
  {
    code: "UP",
    name: "Uttar Pradesh",
    label: "09 - Uttar Pradesh",
    districts: new Array("Lucknow", "Kanpur", "Ghaziabad", "Noida", "Varanasi", "Agra", "Prayagraj")
  },
  {
    code: "BR",
    name: "Bihar",
    label: "10 - Bihar",
    districts: new Array("Patna", "Gaya", "Muzaffarpur", "Bhagalpur", "Purnia")
  },
  {
    code: "JH",
    name: "Jharkhand",
    label: "20 - Jharkhand",
    districts: new Array("Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Hazaribagh")
  },
  {
    code: "OD",
    name: "Odisha",
    label: "21 - Odisha",
    districts: new Array("Bhubaneswar", "Cuttack", "Rourkela", "Sambalpur", "Balasore")
  },
  {
    code: "AS",
    name: "Assam",
    label: "18 - Assam",
    districts: new Array("Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Tinsukia")
  },
  {
    code: "RJ",
    name: "Rajasthan",
    label: "08 - Rajasthan",
    districts: new Array("Jaipur", "Jodhpur", "Udaipur", "Kota", "Bhiwadi")
  },
  {
    code: "HR",
    name: "Haryana",
    label: "06 - Haryana",
    districts: new Array("Gurugram", "Faridabad", "Panipat", "Ambala", "Hisar")
  },
  {
    code: "PB",
    name: "Punjab",
    label: "03 - Punjab",
    districts: new Array("Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda")
  },
  {
    code: "TS",
    name: "Telangana",
    label: "36 - Telangana",
    districts: new Array("Hyderabad", "Warangal", "Nizamabad", "Secunderabad")
  },
  {
    code: "AP",
    name: "Andhra Pradesh",
    label: "37 - Andhra Pradesh",
    districts: new Array("Visakhapatnam", "Vijayawada", "Guntur", "Tirupati", "Nellore")
  },
  {
    code: "MP",
    name: "Madhya Pradesh",
    label: "23 - Madhya Pradesh",
    districts: new Array("Indore", "Bhopal", "Jabalpur", "Gwalior", "Ujjain")
  },
  {
    code: "CG",
    name: "Chhattisgarh",
    label: "22 - Chhattisgarh",
    districts: new Array("Raipur", "Bilaspur", "Durg", "Korba")
  },
  {
    code: "KL",
    name: "Kerala",
    label: "32 - Kerala",
    districts: new Array("Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur")
  }
);

export const ALL_INDIA_NON_LIQUID_GOODS: string[] = new Array(
  "FMCG & Packaged Foods",
  "Industrial Machinery & Spare Parts",
  "Electrical & Electronic Appliances",
  "Textiles, Garments & Fabrics",
  "Pharmaceuticals & Medical Supplies",
  "Hardware, Steel & Iron Rods",
  "Plastic Granules & Polymer Bags",
  "Paper Rolls & Packaging Material",
  "Automobile Parts & Tyres",
  "Agricultural Produce & Grains",
  "Furniture & Wooden Items",
  "Ceramic Tiles & Sanitaryware",
  "Paints & Dry Chemicals (Non-Hazardous)",
  "General Merchandise & Parcel"
);

export const DEFAULT_CREDIT_DAY_PRESETS: number[] = new Array(15, 30, 45, 60);

export const DEFAULT_DELIVERY_PLACES: string[] = new Array(
  "Kolkata",
  "Howrah",
  "Dankuni",
  "Siliguri",
  "Durgapur",
  "Asansol",
  "Mumbai",
  "Bhiwandi",
  "Delhi",
  "Gurugram",
  "Ahmedabad",
  "Surat",
  "Chennai",
  "Bengaluru",
  "Hyderabad",
  "Patna",
  "Ranchi",
  "Jamshedpur",
  "Bhubaneswar",
  "Guwahati"
);

export const DEFAULT_PACKAGE_MODES: string[] = new Array(
  "Carton Box",
  "Gunny Bag / Bora",
  "Plastic Drum",
  "Wooden Crate / Case",
  "Pallet",
  "Bundle / Roll",
  "Loose",
  "Tin / Can"
);

export const DEFAULT_RATE_MODES: string[] = new Array(
  "Per Kg",
  "Per Quintal",
  "Per Ton (MT)",
  "Per Package / Box",
  "Fixed Freight (FTL)"
);

export const DEFAULT_DELIVERY_TYPES: string[] = new Array(
  "Door Delivery",
  "Godown Delivery",
  "Door to Door",
  "Godown to Godown",
  "Door to Godown",
  "Godown to Door"
);

export function mergeDropdownOptions(defaults: string[], custom?: string[]): string[] {
  const combined = new Array<string>();
  for (const item of defaults) {
    if (item && !combined.includes(item)) combined.push(item);
  }
  if (custom && Array.isArray(custom)) {
    for (const item of custom) {
      if (item && !combined.includes(item)) combined.push(item);
    }
  }
  return combined;
}
