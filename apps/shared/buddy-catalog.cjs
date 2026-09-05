// Buddy web showroom catalog. Existing web IDs remain stable. These are demo
// choices, not a live stock/pricing feed. Specs below are limited to facts
// already present in the committed web/voice catalog; null means unconfirmed.
const VERSION = 'buddy-showroom-v1';
const rows = {
  'Living Room Furniture': [
    ['living-reclining-sofa','Power Reclining Sofa','A sofa option with powered reclining.','sofa',{'Style':'Power reclining'}],
    ['living-sectional','Modular Sectional Sofa','A sectional option with a modular layout.','sectional',{'Style':'Modular sectional'}],
  ],
  'Bedroom Furniture': [
    ['bedroom-1','Crown Mark Elmer Queen Bedroom Set','Explore the Elmer queen bedroom set.','bed',{'Collection':'Elmer','Bed size':'Queen'}],
    ['bedroom-2','Crown Mark Nemy Queen Bedroom Set','Explore the Nemy queen bedroom set.','bed',{'Collection':'Nemy','Bed size':'Queen'}],
  ],
  'Dining Room Furniture': [
    ['dining-1','Finling 5-Piece Dining Set','A table and four chairs for your dining space.','dining',{'Pieces':'5','Includes':'Table and four chairs'}],
    ['dining-2','Carter 5-Piece Dining Set','A five-piece option for everyday dining.','dining',{'Pieces':'5'}],
  ],
  Mattresses: [
    ['mattress-hybrid-queen','Queen Hybrid Comfort Mattress','Explore a queen-size hybrid mattress.','mattress',{'Size':'Queen','Construction':'Hybrid'}],
    ['mattress-memory-queen','Queen Memory Foam Mattress','Explore a queen-size memory foam mattress.','mattress',{'Size':'Queen','Construction':'Memory foam'}],
  ],
  Appliances: [
    ['appliance-laundry-pair','Smart Washer and Dryer Pair','Compare a washer and dryer pair for your laundry space.','laundry',{'Appliances':'Washer and dryer'}],
    ['appliance-french-door','French Door Refrigerator','Explore a French door refrigerator option.','fridge',{'Door style':'French door'}],
  ],
  Computers: [
    ['computer-gaming-laptop','Performance Gaming Laptop','Explore a laptop option for gaming.','laptop',{'Form':'Laptop'}],
    ['computer-all-in-one','27-inch All-in-One Computer','Explore an all-in-one desktop computer.','desktop',{'Display':'27 inches','Form':'All-in-one'}],
  ],
  Electronics: [
    ['tv-65-oled','65-inch OLED 4K Smart TV','Compare a 65-inch OLED television.','tv',{'Display':'65 inches','Panel':'OLED','Resolution':'4K'}],
    ['tv-75-qled','75-inch QLED 4K Smart TV','Compare a 75-inch QLED television.','tv',{'Display':'75 inches','Panel':'QLED','Resolution':'4K'}],
  ],
  Smartphones: [
    ['smartphone-iphone-16-pro','Apple iPhone 16 Pro','Explore the iPhone 16 Pro demo option.','phone',{'Model':'iPhone 16 Pro'}],
    ['smartphone-galaxy-s25-ultra','Samsung Galaxy S25 Ultra','Explore the Galaxy S25 Ultra demo option.','phone',{'Model':'Galaxy S25 Ultra'}],
  ],
  Gaming: [
    ['gaming-1','PlayStation 5 Console','Explore the PlayStation console option.','console',{'Console':'PlayStation 5'}],
    ['gaming-2','Xbox Series X Console','Explore the Xbox console option.','console',{'Console':'Xbox Series X'}],
  ],
};
const categories = Object.keys(rows);
function categoryFor(interest = '') {
  const value = String(interest).trim().toLowerCase();
  const exact = categories.find(c => c.toLowerCase() === value);
  if (exact) return exact;
  if (/phone|mobile|iphone|android/.test(value)) return 'Smartphones';
  if (/tv|television|electronics/.test(value)) return 'Electronics';
  if (/bedroom/.test(value)) return 'Bedroom Furniture';
  if (/dining/.test(value)) return 'Dining Room Furniture';
  if (/mattress|bed/.test(value)) return 'Mattresses';
  if (/sofa|couch|living|furniture/.test(value)) return 'Living Room Furniture';
  if (/washer|dryer|refrigerator|appliance/.test(value)) return 'Appliances';
  if (/gaming|playstation|xbox/.test(value)) return 'Gaming';
  if (/computer|laptop/.test(value)) return 'Computers';
  return '';
}
function products(interest = '') {
  const category = categoryFor(interest);
  return (rows[category] || []).map(([id,name,description,illustration,specs],optionIndex) => ({
    id,name,category,optionIndex,description,specs:Object.entries(specs).map(([label,value])=>({label,value})),
    image:{src:`/buddys/images/showroom/${illustration}.svg`,alt:`${category} illustration; not a photograph of the offered model`,kind:'illustration'},
    productUrl:null,price:null,availability:'Confirm model, finish, availability and agreement terms with your store.',
    catalogVersion:VERSION,
  }));
}
module.exports = { VERSION, categories, categoryFor, products };
