export const ALL_INDIA_STATES_DISTRICTS: Record<string, string[]> = {
  "West Bengal": ["Kolkata", "Howrah", "Hooghly", "North 24 Parganas", "South 24 Parganas", "Purba Bardhaman", "Paschim Bardhaman", "Siliguri", "Durgapur", "Asansol", "Malda", "Murshidabad", "Nadia", "Purba Medinipur", "Paschim Medinipur"],
  "Maharashtra": ["Mumbai", "Pune", "Nagpur", "Thane", "Nashik", "Aurangabad", "Solapur", "Kolhapur", "Bhiwandi"],
  "Delhi": ["New Delhi", "North Delhi", "South Delhi", "East Delhi", "West Delhi"],
  "Gujarat": ["Ahmedabad", "Surat", "Vadodara", "Rajkot", "Vapi", "Ankleshwar", "Gandhidham"],
  "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai", "Salem", "Tiruchirappalli", "Hosur"],
  "Karnataka": ["Bengaluru", "Mysuru", "Hubballi", "Mangaluru", "Belagavi"],
  "Uttar Pradesh": ["Lucknow", "Kanpur", "Ghaziabad", "Noida", "Varanasi", "Agra", "Prayagraj"],
  "Bihar": ["Patna", "Gaya", "Muzaffarpur", "Bhagalpur", "Purnia"],
  "Jharkhand": ["Ranchi", "Jamshedpur", "Dhanbad", "Bokaro", "Hazaribagh"],
  "Odisha": ["Bhubaneswar", "Cuttack", "Rourkela", "Sambalpur", "Balasore"],
  "Assam": ["Guwahati", "Silchar", "Dibrugarh", "Jorhat", "Tinsukia"],
  "Rajasthan": ["Jaipur", "Jodhpur", "Udaipur", "Kota", "Bhiwadi"],
  "Haryana": ["Gurugram", "Faridabad", "Panipat", "Ambala", "Hisar"],
  "Punjab": ["Ludhiana", "Amritsar", "Jalandhar", "Patiala", "Bathinda"],
  "Telangana": ["Hyderabad", "Warangal", "Nizamabad", "Secunderabad"],
  "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur", "Tirupati", "Nellore"],
  "Madhya Pradesh": ["Indore", "Bhopal", "Jabalpur", "Gwalior", "Ujjain"],
  "Chhattisgarh": ["Raipur", "Bilaspur", "Durg", "Korba"],
  "Kerala": ["Kochi", "Thiruvananthapuram", "Kozhikode", "Thrissur"]
};

export const ALL_INDIA_NON_LIQUID_GOODS: string[] = [
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
];

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
