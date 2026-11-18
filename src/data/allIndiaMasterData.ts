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

export const DEFAULT_DELIVERY_TYPES: string[] = new Array(
  "Door Delivery",
  "Godown Delivery",
  "Door to Door",
  "Godown to Godown",
  "Door to Godown",
  "Godown to Door"
);

export const DEFAULT_PAYMENT_MODES: string[] = new Array(
  "To Pay",
  "Paid",
  "TBB (To Be Billed)",
  "FOC (Free of Cost)"
);

export const DEFAULT_VEHICLE_TYPES: string[] = new Array(
  "Tata Ace (Chhota Hathi)",
  "Bolero Pickup (1.7 MT)",
  "407 Tempo (2.5 MT)",
  "14 Feet Eicher",
  "17 Feet Eicher",
  "19 Feet Eicher",
  "20 Feet Container",
  "22 Feet Container",
  "24 Feet Container",
  "32 Feet Single Axle (SXL)",
  "32 Feet Multi Axle (MXL)",
  "10 Wheeler Truck (16 MT)",
  "12 Wheeler Truck (21 MT)",
  "14 Wheeler Truck (25 MT)",
  "16 Wheeler Truck (31 MT)",
  "40 Feet Flatbed Trailer"
);
