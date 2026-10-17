// Starter flows the builder can begin from (same node model as the validator).
const blank = (lang = 'english') => ({
  [lang]: {
    start: 'Q1',
    questions: {
      Q1: { nodeType: 'message', text: 'Hi 👋 How can we help you today?', isEnd: false, options: [
        { label: 'A', text: 'Talk to us', next: 'Q2', url: '', handoff: '' },
        { label: 'B', text: 'No thanks', next: 'Q3', url: '', handoff: '' },
      ] },
      Q2: { nodeType: 'message', text: 'Thanks! Our team will get back to you shortly.', isEnd: true, options: [] },
      Q3: { nodeType: 'message', text: 'No problem. Send "hi" any time to start again.', isEnd: true, options: [] },
    },
  },
});

// Shows every node type: menu -> product cards -> steps -> enquiry form
const sample = (lang = 'english') => ({
  [lang]: {
    start: 'Q1',
    questions: {
      Q1: { nodeType: 'message', text: 'Welcome! What would you like to do?', isEnd: false, options: [
        { label: 'A', text: 'See our products', next: 'Q2', url: '', handoff: '' },
        { label: 'B', text: 'How to use', next: 'Q3', url: '', handoff: '' },
        { label: 'C', text: 'Contact us', next: 'Q4', url: '', handoff: '' },
      ] },
      Q2: { nodeType: 'products', text: 'Here are our best sellers:', isEnd: false, productsNext: 'Q1', products: [
        { image: '', title: 'Classic Pack', description: 'Our best-selling combo pack', buttonText: 'View', redirectUrl: 'https://example.com/classic' },
      ] },
      Q3: { nodeType: 'steps', text: 'Here is how to get started:', isEnd: false, stepsNext: 'Q1', closingTitle: 'All done!', closingMessage: 'You are ready to go.', closingImage: '', steps: [
        { image: '', title: 'Open the pack', desc: 'Tear along the dotted line.' },
        { image: '', title: 'Enjoy', desc: 'Serve fresh.' },
      ] },
      Q4: { nodeType: 'form', text: 'Leave your details and we will call you back:', isEnd: false, formSubmitLabel: 'Submit', formSuccessText: '✅ Thanks! We will contact you soon.', formNext: null, formFields: [
        { key: 'customer_name', label: 'Your name', fieldType: 'text', required: true, placeholder: '', options: [], showIf: null },
        { key: 'phone', label: 'Phone number', fieldType: 'tel', required: true, placeholder: '', options: [], showIf: null },
        { key: 'topic', label: 'What is it about?', fieldType: 'select', required: true, placeholder: '', options: ['Order', 'Other'], showIf: null },
        { key: 'order_id', label: 'Order ID', fieldType: 'text', required: true, placeholder: '', options: [], showIf: { field: 'topic', equals: 'Order' } },
      ] },
    },
  },
});

// The wa-sweet-mern ordering flow, as builder nodes. Categories, products, sizes, prices, stock per outlet and outlets all come
// from the admin's Product / Category / Branch pages - nothing is typed into the flow.
//   Q1 menu (categories + Bulk / Track / Outlets rows)  ->  category -> product -> size -> qty -> cart  ->  Checkout
//   Q2 checkout: name -> delivery | pickup -> location -> nearest outlet -> address (or outlet -> slot) -> summary -> Razorpay link
//   Q3 bulk & gifting enquiry   Q4 track my order   Q5 our outlets
const shop = (lang = 'english') => ({
  [lang]: {
    start: 'Q1',
    questions: {
      Q1: {
        nodeType: 'shop', isEnd: false, text: '🙏 Welcome to *{shop}*!\nWhat would you like to do?',
        shopCategories: [], shopProducts: [], checkoutNext: 'Q2',
        shopExtras: [
          { text: '🎁 Bulk & Gifting', description: 'Wedding, festival, corporate', next: 'Q3' },
          { text: '📦 Track my order', description: 'Latest order status', next: 'Q4' },
          { text: '📍 Our outlets', description: 'Address, phone & map', next: 'Q5' },
        ],
      },
      Q2: { nodeType: 'checkout', text: '', isEnd: false, allowDelivery: true, allowPickup: true, askName: true, namePrompt: '', addressPrompt: '' },
      Q3: {
        nodeType: 'bulk', isEnd: false, text: '🎁 *Bulk, gifting & catering*\nWhat is the occasion?', bulkNext: null,
        bulkOccasions: [
          { key: 'wedding', label: '💍 Wedding' }, { key: 'festival', label: '🪔 Festival gifting' },
          { key: 'corporate', label: '🏢 Corporate' }, { key: 'other', label: '🎉 Other / catering' },
        ],
        bulkDetailsPrompt: '', bulkDatePrompt: '', bulkSuccessText: '',
      },
      Q4: { nodeType: 'track', text: '', isEnd: false, trackNext: null },
      Q5: { nodeType: 'outlets', text: '', isEnd: false, outletsMaps: true, outletsNext: null },
    },
  },
});

module.exports = { blank, sample, shop };
