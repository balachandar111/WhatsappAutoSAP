// Utility templates used when the 24-hour customer window is closed (order status updates).
// Variables: {{1}} = customer name, {{2}} = order ID
const DEFS = [
  { name: 'order_ready', text: 'Hi {{1}}, your order {{2}} is ready for pickup at our outlet. Please show this message at the counter.' },
  { name: 'order_packed', text: 'Hi {{1}}, your order {{2}} is packed and will be dispatched soon.' },
  { name: 'order_dispatched', text: 'Hi {{1}}, your order {{2}} is out for delivery and will reach you shortly.' },
  { name: 'order_delivered', text: 'Hi {{1}}, your order {{2}} has been delivered. Thank you for shopping with us!' },
  { name: 'order_cancelled', text: 'Hi {{1}}, your order {{2}} has been cancelled. Our team will contact you if any refund is needed.' },
];
module.exports = { DEFS };
