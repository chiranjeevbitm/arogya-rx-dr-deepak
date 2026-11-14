// The clinic's public facts for the booking page's HTML, JSON-LD and llms.txt.
// Must match the doctor's profile site (Doctors-Profile: FE/src/lib/site.js)
// and his Google Business Profile word for word: same name, address, phone.
// The booking form itself shows the live values from Settings in the app.
export const CLINIC = {
  listingName: 'Arogya Clinic: Dr. Deepak Kumar',
  doctor: 'Dr. Deepak Kumar',
  doctorHi: 'डॉ. दीपक कुमार',
  clinic: 'Arogya Clinic',
  clinicHi: 'आरोग्य क्लिनिक',
  quals: 'MBBS (SKMCH), MD General Medicine (DMCH Darbhanga)',
  street: 'Bada Jagarnath, Shakti Dharmkanta, Ahiyapur',
  locality: 'Muzaffarpur',
  region: 'Bihar',
  postalCode: '842001',
  addressLine: 'Bada Jagarnath, Shakti Dharmkanta, Ahiyapur, Muzaffarpur, Bihar 842001',
  addressHi: 'बड़ा जगरनाथ, शक्ति धर्मकांटा, अहियापुर, मुज़फ़्फ़रपुर, बिहार 842001',
  geo: { lat: 26.150109, lng: 85.400502 },
  phone: '9199943818',
  phoneTel: '+919199943818',
  sessions: [
    { from: '06:00', to: '09:00', en: '6:00–9:00 am', hi: 'सुबह 6–9 बजे' },
    { from: '17:00', to: '21:00', en: '5:00–9:00 pm', hi: 'शाम 5–9 बजे' },
  ],
  hoursShortEn: '6:00–9:00 am and 5:00–9:00 pm',
  mapsUrl: 'https://maps.google.com/?cid=14734122024873463861',
  sameAs: ['https://maps.google.com/?cid=14734122024873463861'],
  profileUrl: 'https://doctors-profile-chi.vercel.app',
  appUrl: 'https://arogya-rx-dr-deepak.vercel.app',
  bookingUrl: 'https://arogya-rx-dr-deepak.vercel.app/book/arogya-clinic',
}
