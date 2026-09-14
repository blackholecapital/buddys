const catalog = require('../../../shared/buddy-catalog.cjs');

// Browser values select known IDs, never supply facts or authorize an order.
function showroomContext(hint, interest) {
  const category = catalog.categories.includes(hint?.category) ? hint.category : catalog.categoryFor(interest);
  const products = catalog.products(category);
  const featured = products.find(product => product.id === hint?.productId);
  const facts = JSON.stringify({category, featuredProduct:featured?.name || null,
    products:products.map(({id,name,description,specs,demoPrice,availability}) => ({id,name,description,specs,demoPrice,availability}))});
  return `[BUDDY SHOWROOM — verified demo catalog]\n${facts}\nDiscuss only these product facts. Prices are demo examples, not quotes or live stock. The featured item is what the customer is viewing, not a purchase or agreement. Mention exact product names to show the matching tile.`.slice(0,4000);
}
module.exports = {showroomContext};
