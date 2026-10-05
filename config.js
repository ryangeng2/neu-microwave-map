// Paste the config object from Firebase console → Project settings → Your apps → Web app.
// These values are public by design; the Firestore rules (firestore.rules) are what protect the data.
// While this is null the site runs in preview mode: entries are saved only in your own browser.
export const firebaseConfig = null;

// Email domains allowed to post. Must match the list in firestore.rules.
export const allowedDomains = ["northeastern.edu", "husky.neu.edu"];
