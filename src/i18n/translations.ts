import type { DisasterType, LanguageCode, Severity } from '../../shared/types';

export const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: 'English',
  as: 'অসমীয়া',
  hi: 'हिन्दी',
};

export interface TranslationDict {
  appName: string;
  tagline: string;
  navDashboard: string;
  navMap: string;
  navSos: string;
  navShelters: string;
  navReports: string;
  navAlerts: string;
  navNotifications: string;
  navAdmin: string;
  navChat: string;
  online: string;
  offline: string;
  lowDataMode: string;
  darkMode: string;
  lightMode: string;
  signIn: string;
  signOut: string;
  installApp: string;
  critical: string;
  high: string;
  moderate: string;
  low: string;
  sosButton: string;
  sosSubtitle: string;
  nearestShelter: string;
  myShelter: string;
  recentReports: string;
  sosInbox: string;
  weatherWatch: string;
  submitReport: string;
  pendingSync: string;
  verified: string;
  submitted: string;
  rejected: string;
  open: string;
  full: string;
  closed: string;
  emergencyNumbers: string;
  rescueAssistant: string;
  disclaimer: string;
}

export const TRANSLATIONS: Record<LanguageCode, TranslationDict> = {
  en: {
    appName: 'DisasterGuard',
    tagline: 'Assam Emergency Command & Response',
    navDashboard: 'Command',
    navMap: 'Map',
    navSos: 'SOS',
    navShelters: 'Shelters',
    navReports: 'Reports',
    navAlerts: 'Alerts',
    navNotifications: 'Inbox',
    navAdmin: 'Admin',
    navChat: 'Assistant',
    online: 'Live Sync',
    offline: 'Offline',
    lowDataMode: 'Low-Data',
    darkMode: 'Dark',
    lightMode: 'Light',
    signIn: 'Sign In',
    signOut: 'Sign Out',
    installApp: 'Install App',
    critical: 'Critical',
    high: 'High',
    moderate: 'Moderate',
    low: 'Low',
    sosButton: 'SEND SOS',
    sosSubtitle: 'Alert district rescue volunteers with GPS & phone',
    nearestShelter: 'Nearest Shelter',
    myShelter: 'My Assigned Shelter',
    recentReports: 'Recent Field Reports',
    sosInbox: 'District SOS Inbox',
    weatherWatch: 'Assam River & Weather Watch',
    submitReport: 'Submit Field Report',
    pendingSync: 'Pending Sync',
    verified: 'Verified',
    submitted: 'Submitted',
    rejected: 'Rejected',
    open: 'Open',
    full: 'Full',
    closed: 'Closed',
    emergencyNumbers: 'Official Emergency Helplines',
    rescueAssistant: 'Rescue Assistant',
    disclaimer: 'Automated guidance only. For life-threatening emergencies, call 112 or 1070 immediately.',
  },
  as: {
    appName: 'DisasterGuard',
    tagline: 'অসম জৰুৰীকালীন সঁহাৰি কেন্দ্ৰ',
    navDashboard: 'ডেশ্বব’ৰ্ড',
    navMap: 'মানচিত্ৰ',
    navSos: 'SOS',
    navShelters: 'আশ্ৰয় শিবিৰ',
    navReports: 'প্ৰতিবেদন',
    navAlerts: 'সতৰ্কবাণী',
    navNotifications: 'জাননী',
    navAdmin: 'প্ৰশাসক',
    navChat: 'সহায়ক',
    online: 'লাইভ সংযোগ',
    offline: 'অফলাইন',
    lowDataMode: 'কম ডাটা',
    darkMode: 'ডাৰ্ক',
    lightMode: 'লাইট',
    signIn: 'লগইন কৰক',
    signOut: 'প্ৰস্থান',
    installApp: 'এপ্ ইনষ্টল',
    critical: 'অতি জৰুৰী',
    high: 'উচ্চ',
    moderate: 'মধ্যম',
    low: 'নিম্ন',
    sosButton: 'SOS পঠাওক',
    sosSubtitle: 'জিলা স্বেচ্ছাসেৱকলৈ জিপিএছ আৰু ফোন নম্বৰ পঠাওক',
    nearestShelter: 'নিকটতম আশ্ৰয় শিবিৰ',
    myShelter: 'মোৰ নিৰ্ধাৰিত শিবিৰ',
    recentReports: 'শেহতীয়া ক্ষেত্ৰ প্ৰতিবেদন',
    sosInbox: 'জিলা SOS ইনবক্স',
    weatherWatch: 'অসম বতৰ আৰু বান নিৰীক্ষণ',
    submitReport: 'প্ৰতিবেদন দাখিল কৰক',
    pendingSync: 'ছিংক অপেক্ষাত',
    verified: 'সত্যায়িত',
    submitted: 'দাখিল কৰা হৈছে',
    rejected: 'নাকচ কৰা হৈছে',
    open: 'খোলা',
    full: 'পূৰ্ণ',
    closed: 'বন্ধ',
    emergencyNumbers: 'চৰকাৰী জৰুৰীকালীন হেল্পলাইন',
    rescueAssistant: 'উদ্ধাৰ সহায়ক',
    disclaimer: 'এয়া কেৱল স্বয়ংক্ৰিয় নিৰ্দেশনা। জীৱন সংকটজনক অৱস্থাত ১১২ বা ১০৭০ নম্বৰত ফোন কৰক।',
  },
  hi: {
    appName: 'DisasterGuard',
    tagline: 'असम आपदा प्रतिक्रिया एवं कमांड केंद्र',
    navDashboard: 'कमांड',
    navMap: 'मानचित्र',
    navSos: 'SOS',
    navShelters: 'आश्रय',
    navReports: 'रिपोर्ट',
    navAlerts: 'चेतावनी',
    navNotifications: 'सूचनाएं',
    navAdmin: 'प्रशासन',
    navChat: 'सहायक',
    online: 'लाइव सिंक',
    offline: 'ऑफ़लाइन',
    lowDataMode: 'कम डेटा',
    darkMode: 'डार्क',
    lightMode: 'लाइट',
    signIn: 'साइन इन',
    signOut: 'लॉग आउट',
    installApp: 'ऐप इंस्टॉल',
    critical: 'अत्यंत गंभीर',
    high: 'उच्च',
    moderate: 'मध्यम',
    low: 'कम',
    sosButton: 'SOS भेजें',
    sosSubtitle: 'जिला बचाव स्वयंसेवकों को GPS और फ़ोन भेजें',
    nearestShelter: 'निकटतम आश्रय',
    myShelter: 'मेरा निर्धारित आश्रय',
    recentReports: 'हालिया फील्ड रिपोर्ट',
    sosInbox: 'जिला SOS इनबॉक्स',
    weatherWatch: 'असम मौसम व बाढ़ निगरानी',
    submitReport: 'रिपोर्ट सबमिट करें',
    pendingSync: 'सिंक लंबित',
    verified: 'सत्यापित',
    submitted: 'प्रस्तुत',
    rejected: 'अस्वीकृत',
    open: 'खुला',
    full: 'पूर्ण',
    closed: 'बंद',
    emergencyNumbers: 'आधिकारिक आपातकालीन हेल्पलाइन',
    rescueAssistant: 'बचाव सहायक',
    disclaimer: 'यह केवल स्वचालित मार्गदर्शन है। जानलेवा आपात स्थिति में तुरंत 112 या 1070 पर कॉल करें।',
  },
};

export const DISASTER_TYPE_LABELS: Record<LanguageCode, Record<DisasterType, string>> = {
  en: {
    flood: 'Flood',
    landslide: 'Landslide',
    storm: 'Storm',
    earthquake: 'Earthquake',
    fire: 'Fire',
    lightning: 'Lightning',
  },
  as: {
    flood: 'বানপানী',
    landslide: 'ভূমিস্খলন',
    storm: 'ধুমুহা',
    earthquake: 'ভূমিকম্প',
    fire: 'অগ্নিকাণ্ড',
    lightning: 'বজ্ৰপাত',
  },
  hi: {
    flood: 'बाढ़',
    landslide: 'भूस्खलन',
    storm: 'तूफ़ान',
    earthquake: 'भूकंप',
    fire: 'आग',
    lightning: 'आकाशीय बिजली',
  },
};

export function severityLabel(sev: Severity, lang: LanguageCode): string {
  const dict = TRANSLATIONS[lang];
  if (sev === 'CRITICAL') return dict.critical;
  if (sev === 'HIGH') return dict.high;
  if (sev === 'MODERATE') return dict.moderate;
  return dict.low;
}
