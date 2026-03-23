const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cors = require('cors');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(bodyParser.json());

// Create Stripe Checkout Session
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { items, customer } = req.body;
    
    if (!items || items.length === 0) {
      return res.status(400).json({ error: 'No items in cart' });
    }

    // Create line items for Stripe
    const lineItems = items.map(item => ({
      price_data: {
        currency: 'aud',
        product_data: {
          name: item.name,
          description: item.notes ? `Note: ${item.notes}` : '',
        },
        unit_amount: Math.round(item.price * 100),
      },
      quantity: item.quantity || 1,
    }));

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: lineItems,
      mode: 'payment',
      success_url: `${process.env.SUCCESS_URL || 'https://fancycardboardstore.com/cart.html'}?success=true`,
      cancel_url: `${process.env.CANCEL_URL || 'https://fancycardboardstore.com/cart.html'}?canceled=true`,
      customer_email: customer.email,
      metadata: {
        customer_name: customer.name,
        customer_phone: customer.phone || '',
        shipping_address: `${customer.address}, ${customer.suburb}, ${customer.state} ${customer.postcode}`,
        order_notes: customer.notes || '',
      },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (error) {
    console.error('Error creating checkout session:', error);
    res.status(500).json({ error: error.message });
  }
});

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Fancy Cardboard Store backend is running' });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});