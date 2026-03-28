with open('shop-onepiece.html', 'r') as f:
    content = f.read()

# Add shipping after price
old = '<div class="product-price">$${card.price.toFixed(2)}</div>'
new = '''<div class="product-price">$${card.price.toFixed(2)}</div>
          ${card.price > 30 ? '<div style="font-size:0.8em;color:#666;">+ $10.00 shipping</div>' : ''}'''

content = content.replace(old, new)

with open('shop-onepiece.html', 'w') as f:
    f.write(content)

print('Done!')
