const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const INVENTORY_FILE = path.join(__dirname, 'inventory.json');

app.use(cors());
app.use(bodyParser.json());

// Initialize inventory file if it doesn't exist
function initInventory() {
  const defaultInventory = {
    'lorcana-fabled-booster': {
      name: 'Disney Lorcana - Fabled Booster Box',
      price: 519.95,
      image: 'images/lorcana-fabled-booster.png',
      stock: 1,
      category: 'Disney Lorcana',
      description: 'The 9th set in the Disney Lorcana TCG. Each booster box contains 24 packs, with 12 cards per pack including a guaranteed foil card. With 24 foil cards per box and chances to find Super Rare, Legendary, and Enchanted cards.',
      details: 'Factory sealed | 24 packs per box | 12 cards per pack | 24 foil cards (1 per pack) | Chance for Enchanted cards'
    },
    'lorcana-fabled-booster-unsealed': {
      name: 'Disney Lorcana - Fabled Booster Box (Unsealed)',
      price: 399.95,
      image: 'images/lorcana-fabled-booster.png',
      stock: 2,
      category: 'Disney Lorcana',
      description: 'Get the complete Fabled booster box experience at a reduced price. The outer wrap has been removed but all 24 packs inside remain factory sealed. Same great cards, better value.',
      details: 'All packs still factory sealed | 24 packs per box | 12 cards per pack | 24 foil cards (1 per pack) | Chance for Enchanted cards'
    }
  };
  
  if (!fs.existsSync(INVENTORY_FILE)) {
    fs.writeFileSync(INVENTORY_FILE, JSON.stringify(defaultInventory, null, 2));
  }
}

initInventory();

// Get inventory
function getInventory() {
  try {
    return JSON.parse(fs.readFileSync(INVENTORY_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

// Save inventory
function saveInventory(inventory) {
  fs.writeFileSync(INVENTORY_FILE, JSON.stringify(inventory, null, 2));
}

// Get all products
app.get('/api/products', (req, res) => {
  const inventory = getInventory();
  const products = Object.entries(inventory).map(([id, data]) => ({
    id,
    ...data,
    badge: data.stock > 0 ? (data.stock === 1 ? 'Only 1 Left' : data.stock === 2 ? 'Only 2 Left' : 'In Stock') : 'Sold Out'
  }));
  res.json(products);
});

// Get single product
app.get('/api/products/:id', (req, res) => {
  const inventory = getInventory();
  const product = inventory[req.params.id];
  if (!product) {
    return res.status(404).json({ error: 'Product not found' });
  }
  res.json({
    id: req.params.id,
    ...product,
    badge: product.stock > 0 ? (product.stock === 1 ? 'Only 1 Left' : product.stock === 2 ? 'Only 2 Left' : 'In Stock') : 'Sold Out'
  });
});

// Check stock before checkout
function checkStock(items) {
  const inventory = getInventory();
  const errors = [];
  
  for (const item of items) {
    // Skip shipping items
    if (item.name === 'Shipping') continue;
    
    const product = Object.entries(inventory).find(([id, p]) => p.name === item.name);
    if (!product) {
      errors.push(`${item.name} is no longer available`);
    } else if (product[1].stock < (item.quantity || 1)) {
      errors.push(`Not enough stock for ${item.name}. Only ${product[1].stock} available.`);
    }
  }
  
  return errors;
}

// Decrement stock after successful payment
function decrementStock(items) {
  const inventory = getInventory();
  
  for (const item of items) {
    if (item.name === 'Shipping') continue;
    
    for (const [id, product] of Object.entries(inventory)) {
      if (product.name === item.name) {
        inventory[id].stock = Math.max(0, product.stock - (item.quantity || 1));
        break;
      }
    }
  }
  
  saveInventory(inventory);
}

app.post('/create-checkout-session', async (req, res) => {
  try {
    const { items, customer } = req.body;
    
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'No items in cart' });
    }

    // Check stock before creating checkout
    const stockErrors = checkStock(items);
    if (stockErrors.length > 0) {
      return res.status(400).json({ error: stockErrors.join('. ') });
    }

    const lineItems = items.map(item => ({
      price_data: {
        currency: 'aud',
        product_data: {
          name: item.name,
          description: item.notes && item.notes.trim() ? item.notes : undefined,
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity || 1,
    }));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: process.env.SUCCESS_URL || 'https://fancycardboardstore.com/success.html',
      cancel_url: process.env.CANCEL_URL || 'https://fancycardboardstore.com/cart.html?canceled=true',
      customer_email: customer.email,
      metadata: {
        customer_name: customer.name,
        customer_phone: customer.phone || '',
        shipping_address: `${customer.address}, ${customer.suburb}, ${customer.state} ${customer.postcode}`,
        order_notes: customer.notes || '',
        items: JSON.stringify(items.map(i => ({ name: i.name, quantity: i.quantity || 1 }))),
      },
    });

    // Decrement stock after checkout session created (will be confirmed on webhook)
    decrementStock(items);

    res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Stripe webhook for payment confirmation
app.post('/webhook', express.raw({type: 'application/json'}), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    console.log('Payment successful for session:', session.id);
  }

  res.json({received: true});
});

app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Fancy Cardboard Store API' });
});

app.listen(PORT, () => {
  console.log('Running on port', PORT);
});
