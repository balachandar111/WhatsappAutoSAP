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

module.exports = { blank, sample };
