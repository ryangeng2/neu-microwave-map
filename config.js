// Firebase web config (Firebase console → Project settings → Your apps → Web app).
// These values are public by design; the Firestore rules (firestore.rules) are what protect the data.
// Set this to null to run in preview mode, where entries are saved only in your own browser.
export const firebaseConfig = {
  apiKey: "AIzaSyBTqPMteAMANJg5_MDkl35gfhmPlcm79KM",
  authDomain: "neu-microwave-map.firebaseapp.com",
  projectId: "neu-microwave-map",
  storageBucket: "neu-microwave-map.firebasestorage.app",
  messagingSenderId: "968920596202",
  appId: "1:968920596202:web:97f1766717fda9808ee193",
};

// Email domains allowed to post. Must match the list in firestore.rules.
export const allowedDomains = ["northeastern.edu", "husky.neu.edu"];
