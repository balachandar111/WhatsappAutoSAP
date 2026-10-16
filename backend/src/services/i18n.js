// Small built-in phrase book for the WhatsApp flow engine's own messages (buttons, validation errors).
// The flow's content itself is whatever the admin typed. Unknown languages fall back to English.
const EN = {
  next: 'Next ▶', back: '◀ Back', finish: 'Finish ✔', skip: 'Skip', cont: 'Continue ▶', choose: 'Choose option',
  more: 'More options ➡️', morePage: 'Page', pick: 'Please choose one of the options below 👇', step: 'Step',
  thanks: '✅ Thank you! Your details have been received.', allDone: '🎉 All done!', cancelled: 'Cancelled.',
  chooseLang: '🌐 Please choose your language', optional: '(optional)', cancelHint: 'Type *cancel* to stop.',
  required: 'This field is required.', invalidNumber: 'Please enter a valid number.', invalidTel: 'Please enter a valid phone number.',
  invalidEmail: 'Please enter a valid email address.', invalidDate: 'Please enter a valid date as DD/MM/YYYY.',
  tooLong: 'That is too long. Please shorten it.', sendFile: 'Please send a photo or document.', selectOne: 'Please choose one of the options.',
  ended: 'Send *hi* to start again.', anythingElse: 'Anything else?', link: 'Link', noOrdering: 'Ordering is not available right now. Please try later 🙏',
  hintDate: 'Format: DD/MM/YYYY', hintTel: 'Digits only, e.g. 9876543210', hintFile: 'Send a photo or a document',
};
const TA = {
  next: 'அடுத்து ▶', back: '◀ பின்', finish: 'முடிக்க ✔', skip: 'தவிர்', cont: 'தொடரவும் ▶', choose: 'தேர்வு செய்க',
  more: 'மேலும் ➡️', pick: 'கீழே உள்ளவற்றில் ஒன்றைத் தேர்ந்தெடுக்கவும் 👇', step: 'படி',
  thanks: '✅ நன்றி! உங்கள் விவரங்கள் பெறப்பட்டன.', allDone: '🎉 முடிந்தது!', cancelled: 'ரத்து செய்யப்பட்டது.',
  chooseLang: '🌐 உங்கள் மொழியைத் தேர்ந்தெடுக்கவும்', optional: '(விருப்பம்)', required: 'இந்தத் தகவல் தேவை.',
  selectOne: 'ஒரு விருப்பத்தைத் தேர்ந்தெடுக்கவும்.', anythingElse: 'வேறு ஏதேனும்?',
};
const HI = {
  next: 'आगे ▶', back: '◀ पीछे', finish: 'समाप्त ✔', skip: 'छोड़ें', cont: 'जारी रखें ▶', choose: 'चुनें',
  more: 'और विकल्प ➡️', pick: 'कृपया नीचे दिए विकल्पों में से चुनें 👇', step: 'चरण',
  thanks: '✅ धन्यवाद! आपकी जानकारी मिल गई है।', allDone: '🎉 पूरा हुआ!', cancelled: 'रद्द किया गया।',
  chooseLang: '🌐 कृपया अपनी भाषा चुनें', optional: '(वैकल्पिक)', required: 'यह जानकारी आवश्यक है।',
  selectOne: 'कृपया एक विकल्प चुनें।', anythingElse: 'और कुछ?',
};
const BOOK = { english: EN, tamil: { ...EN, ...TA }, hindi: { ...EN, ...HI } };
const t = (lang, key) => (BOOK[lang] || EN)[key] || EN[key] || key;
module.exports = { t };
