/**
 * The published documents (docs/SAFETY_AND_LEGAL.md 6): one source for the
 * app (GET /api/v1/legal/:slug, drawn natively) and the web
 * (GET /legal/:slug, public pages Google Play and Apple can link to).
 *
 * Raising LEGAL_VERSION asks everyone to agree again (the app's Terms gate).
 * Only do that when the Terms or Privacy Policy change in substance.
 *
 * {{SUPPORT_EMAIL}} and {{GRIEVANCE_OFFICER}} are filled in from the
 * environment when served (legalConfig below).
 */
export const LEGAL_VERSION = 1;
export const LEGAL_UPDATED = '2026-10-24';

export type LegalBlock =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'note'; text: string };
export type LegalSection = { heading: string; blocks: LegalBlock[] };
export type LegalDocument = { slug: string; title: string; summary: string; sections: LegalSection[] };

const p = (text: string): LegalBlock => ({ type: 'p', text });
const list = (...items: string[]): LegalBlock => ({ type: 'list', items });
const note = (text: string): LegalBlock => ({ type: 'note', text });

export function legalConfig() {
  const support = process.env.SUPPORT_EMAIL || 'noreply.iemconnect@gmail.com';
  return {
    supportEmail: support,
    grievanceOfficer: process.env.GRIEVANCE_OFFICER
      || `Grievance Officer: to be appointed. Until then, write to ${support} with "Grievance" in the subject; we follow the same timelines.`,
    publicUrl: (process.env.PUBLIC_WEB_URL || 'http://localhost:3000').replace(/\/$/, ''),
  };
}

const DOCUMENTS: LegalDocument[] = [
  {
    slug: 'terms',
    title: 'Terms of Service',
    summary: 'The rules for using IEM Connect: who can join, what is not allowed, and what happens when the rules are broken.',
    sections: [
      { heading: '1. About these Terms', blocks: [
        p('IEM Connect ("we", "us") is a dating and social app for college students. These Terms are an agreement between you and us. By creating an account or using the app you agree to them, to our Privacy Policy and to our Community Guidelines.'),
        p('If you do not agree, do not use the app.'),
      ] },
      { heading: '2. Who can use IEM Connect', blocks: [
        list(
          'You must be at least 18 years old. We do not allow anyone under 18, even with a parent\'s permission.',
          'You must be a real person using your own identity, photos and details.',
          'You must not have been banned from IEM Connect before.',
          'You must follow the laws of India and of the place you use the app from.',
        ),
        p('A college email shows where you study; it is not proof of age. Giving a false birthday is a serious breach of these Terms.'),
      ] },
      { heading: '3. Your account', blocks: [
        list(
          'Keep your password and devices secure. You are responsible for what happens on your account.',
          'One person, one account. Do not share, sell or transfer it.',
          'Keep your details accurate, including your birthday and college.',
          'You can delete your account at any time in Settings > Account and data > Delete account, or on our website.',
        ),
      ] },
      { heading: '4. Verification', blocks: [
        p('You can verify your college with your college email, and complete a selfie check that compares a live selfie with your profile photos. Some features are limited until you verify. Verification shows that an account passed our checks; it does not guarantee anything about a person, and you should always take care when meeting someone.'),
      ] },
      { heading: '5. What is not allowed', blocks: [
        p('Our Community Guidelines explain these in detail. In short, you must not:'),
        list(
          'Use the app if you are under 18, or contact, sexualise or exploit anyone under 18.',
          'Pretend to be someone else, use someone else\'s photos, or create fake accounts.',
          'Harass, threaten, stalk, bully or abuse anyone, on or off the app.',
          'Send sexual content to someone who has not clearly asked for it.',
          'Share intimate images of anyone without their consent.',
          'Post hate speech or discriminate by caste, religion, race, gender, sexuality, disability or any other identity.',
          'Scam people, ask for money, sell things or services (including sex), or promote other apps, accounts or links.',
          'Use bots, scrape data, or interfere with the app or its security.',
          'Break any law.',
        ),
      ] },
      { heading: '6. Your content', blocks: [
        p('You own the photos, videos, messages and stories you post. You give us a non-exclusive, royalty-free licence to store, show and process them only to run the app for you and the people you share them with. This licence ends when you delete the content or your account, except where we must keep it by law or for safety (see the Privacy Policy).'),
        p('Do not post anything you do not have the right to share.'),
      ] },
      { heading: '7. Safety, reports and moderation', blocks: [
        p('You can report or block anyone. Reports are reviewed by our team, usually within 24 hours. We may remove content, warn, hide, suspend or ban accounts that break these Terms, and we may report illegal activity to the police.'),
        p('A report that someone may be under 18 hides their profile at once while we review it. We record the identities of banned accounts (in a form that cannot be read back) so they cannot sign up again.'),
      ] },
      { heading: '8. Appeals', blocks: [
        p('If your account was hidden, suspended or banned and you think we made a mistake, write to {{SUPPORT_EMAIL}} with "Appeal" in the subject, from the email on your account. We reply within 15 days.'),
      ] },
      { heading: '9. Meeting people', blocks: [
        p('We do not run background checks and are not responsible for how people behave on or off the app. Meet in public, tell a friend, and read our Safety Centre. If you are in danger, call 112.'),
      ] },
      { heading: '10. The service', blocks: [
        p('The app is provided "as is". We work to keep it running and secure but cannot promise it will always be available or free of errors. To the extent the law allows, we are not liable for indirect losses or for the actions of other users.'),
        p('We may change or stop features. We may update these Terms; if a change matters, we will tell you in the app and ask you to agree again.'),
      ] },
      { heading: '11. Law and complaints', blocks: [
        p('These Terms are governed by the laws of India. Complaints go first to our Grievance Officer (see Grievance Redressal). Courts in Kolkata, West Bengal have jurisdiction, subject to any rights you have under Indian consumer law.'),
        p('Contact: {{SUPPORT_EMAIL}}.'),
      ] },
    ],
  },
  {
    slug: 'privacy',
    title: 'Privacy Policy',
    summary: 'What we collect, why, how long we keep it, who we share it with, and your rights under India\'s Digital Personal Data Protection Act.',
    sections: [
      { heading: '1. Who we are', blocks: [
        p('IEM Connect is the data fiduciary for your personal data under the Digital Personal Data Protection Act, 2023. Contact us at {{SUPPORT_EMAIL}}.'),
      ] },
      { heading: '2. What we collect, and why', blocks: [
        list(
          'Account: email, password (stored only as a secure hash), Google sign-in details if you use Google. To create and secure your account.',
          'Profile: name, birthday and age, gender, orientation, what you are looking for, photos, a video, interests, bio, college, department, year. To show your profile and find matches.',
          'College verification: your college email and when it was verified. To show you are a student there and to unlock features.',
          'Selfie check: snapshots taken during the check, and a face key - numbers measured from your face. To confirm your photos show you. See section 4.',
          'Location: your approximate location while you use location features, and places you save. To show people nearby and on the map. We show others an approximate distance, never your exact location.',
          'Activity: likes, passes, matches, Roses, follows, stories, views, messages and the media in them. To run those features.',
          'Safety: reports you make or receive, blocks, and moderation decisions. To keep people safe.',
          'Feedback: problems you report (what you write, screenshots and a screen recording you add, and - if you leave it on - the app version, phone model, the screen you were on and the app’s recent errors), and ratings you give in the app. To fix problems and improve the app. Only our team sees them.',
          'Nudity check: profile photos and videos, Stories, and photos and videos sent in chat are checked automatically for nudity, on our own servers - they are not sent to anyone else. We keep only a score. Explicit profile media and Stories are refused; borderline ones wait for our team before anyone else sees them; flagged chat media arrives covered, for the person receiving it to choose whether to look.',
          'Device: device type, app version, push notification token, the IP address of each signed-in device, the Android ID you signed up on. To deliver notifications, show you your signed-in devices, and stop banned people from coming back.',
        ),
        p('We do not sell your personal data and do not show third-party ads.'),
      ] },
      { heading: '3. Consent', blocks: [
        p('We process your data with your consent, which you give when you create your account and agree to this Policy, and for some features when you turn them on (location, notifications, the selfie check). You can withdraw consent for a feature in its settings, or for everything by deleting your account. Withdrawing does not affect what was lawfully done before.'),
      ] },
      { heading: '4. Face data', blocks: [
        list(
          'The selfie check is optional, except for accounts made with Google, which need it to stay visible.',
          'We store a face key, not your selfie: snapshots are deleted after the check, or kept up to 7 days only if our team needs to review it.',
          'The face key is encrypted and used only to check your own profile photos and video.',
          'You can remove it at any time in Settings > Account; this also removes your blue badge.',
        ),
      ] },
      { heading: '5. Who sees your data', blocks: [
        list(
          'Other users see your profile, photos, stories (as you choose), approximate distance and messages you send them. They never see your email, birthday date or exact location.',
          'Service providers who run the app for us: cloud hosting and database, file storage, email delivery, and push notification services (Google Firebase, Expo). They process data only on our instructions.',
          'The police or a court, when Indian law requires it, and to report child sexual abuse material as the law requires.',
        ),
      ] },
      { heading: '6. How long we keep it', blocks: [
        list(
          'Your account and profile: until you delete your account. Deletion starts a 30-day period in which you can change your mind; then your data is erased.',
          'Messages: until you or the other person deletes them, or the chat ends, and as long as your account exists.',
          'Selfie snapshots: deleted after the check (at most 7 days if reviewed).',
          'Screenshots and recordings in problem reports: deleted when the report is closed, and at most after 90 days.',
          'Records of banned accounts: kept as unreadable hashes so they cannot sign up again.',
          'Reports, moderation records and security logs: up to one year, or longer where the law requires.',
        ),
      ] },
      { heading: '7. Your rights', blocks: [
        list(
          'Access: Settings > Account and data > Export my data gives you a copy.',
          'Correction: edit your profile at any time; ask us to correct anything else.',
          'Erasure: delete your account in the app or on our website.',
          'Withdraw consent: in each feature\'s settings, or by deleting your account.',
          'Nominate someone to exercise your rights if you die or cannot: write to us.',
          'Grievance: write to our Grievance Officer (see Grievance Redressal). If you are not satisfied, you may complain to the Data Protection Board of India.',
        ),
      ] },
      { heading: '8. Security', blocks: [
        p('Data is encrypted in transit; passwords are hashed; face keys are encrypted at rest; staff access is limited and every staff action is logged. If a breach affects you, we will tell you and the Data Protection Board as the law requires.'),
      ] },
      { heading: '9. Children', blocks: [
        p('IEM Connect is only for adults. We do not knowingly collect data from anyone under 18. If we learn an account belongs to someone under 18, we hide it at once and delete it.'),
      ] },
      { heading: '10. Changes', blocks: [
        p('We will tell you in the app before an important change takes effect, and ask you to agree again where needed.'),
      ] },
    ],
  },
  {
    slug: 'guidelines',
    title: 'Community Guidelines',
    summary: 'How we expect everyone to behave, with examples - and what happens when someone doesn\'t.',
    sections: [
      { heading: 'Be yourself', blocks: [
        list('Use your own recent photos. No celebrities, filters that hide who you are, or other people\'s pictures.', 'Your age, college and details must be true.', 'One account per person.'),
      ] },
      { heading: 'Respect each other', blocks: [
        list(
          'No harassment, threats, bullying or stalking. When someone says no, or stops replying, stop.',
          'No sexual messages or images unless the other person has clearly said yes. Never send nude images unasked.',
          'No hate: nothing that attacks people for caste, religion, race, ethnicity, gender, sexuality, disability or where they come from.',
          'No violence or threats of violence, on the app or off it.',
        ),
      ] },
      { heading: 'Keep it safe', blocks: [
        list(
          'Under 18s are never allowed. Anything sexual involving a minor is reported to the police.',
          'Never share intimate images of anyone without their consent. We remove them within 24 hours of a report.',
          'No scams: never ask for money, gifts, crypto or investment, and never send them.',
          'No selling - including sex or "services" - and no promoting other apps, accounts or links.',
          'No spam or bots.',
          'Nothing illegal: drugs, weapons, or anything else against Indian law.',
        ),
      ] },
      { heading: 'Off the app', blocks: [
        p('These rules also apply to what you do to people you met on IEM Connect, offline or on other apps. Report it to us; for anything criminal, also tell the police.'),
      ] },
      { heading: 'What happens if the rules are broken', blocks: [
        list(
          'We may remove content, send a warning, hide a profile, suspend it for a time, or ban it for good.',
          'A ban is permanent: the person cannot sign up again with the same Google account, emails, college email or phone.',
          'Serious harm - anything involving minors, threats, or intimate images - can mean an immediate ban and a report to the police.',
          'You can appeal a decision: write to {{SUPPORT_EMAIL}} with "Appeal" in the subject.',
        ),
      ] },
      { heading: 'Report and block', blocks: [
        p('Tap ··· on a profile, a story or a message, or Chat info, and choose Report. The person is never told who reported them. You can block them in the same step.'),
      ] },
    ],
  },
  {
    slug: 'child-safety',
    title: 'Child Safety Standards',
    summary: 'Our zero-tolerance standards against child sexual abuse and exploitation (CSAE).',
    sections: [
      { heading: 'Zero tolerance', blocks: [
        p('IEM Connect is for adults only. We do not tolerate child sexual abuse and exploitation (CSAE) or child sexual abuse material (CSAM) of any kind, including grooming, sexualising minors, sextortion, or trafficking.'),
      ] },
      { heading: 'Keeping minors out', blocks: [
        list(
          'Everyone must be 18 or over; we check the birthday at sign-up and do not let anyone younger in.',
          'Changing a birthday needs an ID check by our team.',
          'A report that someone may be under 18 hides their profile at once until our team has reviewed it.',
        ),
      ] },
      { heading: 'Reporting', blocks: [
        p('Anyone can report a profile, message, story or note in the app with the reason "Under 18", or write to {{SUPPORT_EMAIL}}. We review these reports first.'),
      ] },
      { heading: 'What we do', blocks: [
        list(
          'We remove CSAM as soon as we know of it and ban the accounts involved.',
          'We report it, as Indian law (the POCSO Act, 2012 and the IT Act, 2000) requires, to the police and through the National Cyber Crime Reporting Portal (cybercrime.gov.in), and preserve what the law requires for the investigation.',
          'We cooperate with law enforcement.',
        ),
      ] },
      { heading: 'Contact', blocks: [
        p('Child safety contact: {{SUPPORT_EMAIL}}. If a child is in immediate danger, call 112, or the Childline at 1098.'),
      ] },
    ],
  },
  {
    slug: 'grievance',
    title: 'Grievance Redressal',
    summary: 'How to complain about content, an account or how we handle your data, and how fast we respond.',
    sections: [
      { heading: 'Grievance Officer', blocks: [
        p('{{GRIEVANCE_OFFICER}}'),
        p('Email: {{SUPPORT_EMAIL}}'),
      ] },
      { heading: 'What you can raise', blocks: [
        list(
          'Content or an account that breaks our Terms or Indian law.',
          'Intimate images of you shared without your consent, or someone impersonating you.',
          'A decision we made about your account.',
          'How we handle your personal data, or a request about your data rights.',
        ),
      ] },
      { heading: 'How fast we respond', blocks: [
        list(
          'We acknowledge every complaint within 24 hours.',
          'We resolve it within 15 days.',
          'Content showing you nude or in a sexual act, or impersonating you, is removed within 24 hours of your complaint.',
        ),
      ] },
      { heading: 'How to write to us', blocks: [
        p('Email {{SUPPORT_EMAIL}} from the email on your account, with "Grievance" in the subject. Say what happened, the person\'s name as it shows in the app, and add screenshots if you have them.'),
      ] },
      { heading: 'If you are not satisfied', blocks: [
        p('You can appeal to the Grievance Appellate Committee set up by the Government of India within 30 days of our decision, and for personal data complaints, to the Data Protection Board of India.'),
      ] },
    ],
  },
  {
    slug: 'safety',
    title: 'Safety Centre',
    summary: 'Tips for meeting safely, spotting scams, and getting help.',
    sections: [
      { heading: 'If you are in danger', blocks: [
        note('Call 112 for emergencies. Women\'s helpline: 181. Cyber crime: 1930 or cybercrime.gov.in. Mental health support (Tele-MANAS): 14416.'),
      ] },
      { heading: 'Before you meet', blocks: [
        list(
          'Chat in the app first. Video call before meeting if you can.',
          'Look for the blue badge: their college and selfie are verified.',
          'Tell a friend who you are meeting, where and when.',
          'Arrange your own way there and back.',
        ),
      ] },
      { heading: 'On the date', blocks: [
        list(
          'Meet in a public place - a cafe on or near campus is ideal.',
          'Keep your phone charged and your drink with you.',
          'Leave whenever you feel uncomfortable. You don\'t owe anyone your time.',
        ),
      ] },
      { heading: 'Online', blocks: [
        list(
          'Never send money, gift cards, crypto or investment to someone you met here, however good the story.',
          'Be careful with links, and with requests to move to WhatsApp, Telegram or another app quickly.',
          'Never share passwords, codes we send you, or bank details.',
          'Think before sharing intimate photos. If someone threatens to share yours, report it - and remember it is not your fault.',
        ),
      ] },
      { heading: 'Report and block', blocks: [
        p('Tap ··· on a profile, story or message, or Chat info, and choose Report. They are never told it was you. You can also report someone after you unmatched or blocked them: Settings > Safety and help > Report someone.'),
      ] },
    ],
  },
  {
    slug: 'law-enforcement',
    title: 'Law Enforcement Guidelines',
    summary: 'How police and government agencies can request information from IEM Connect.',
    sections: [
      { heading: 'Requests', blocks: [
        p('We respond to valid legal requests under Indian law, including notices under the Bharatiya Nagarik Suraksha Sanhita and orders under the IT Act, 2000. Send requests on official letterhead from an official email address to {{SUPPORT_EMAIL}} with "Law enforcement request" in the subject.'),
        list('The agency, officer name, rank and contact.', 'The legal basis for the request.', 'The account: name as shown in the app, email, or a screenshot.', 'What information is needed and for what period.'),
      ] },
      { heading: 'Emergencies', blocks: [
        p('Where there is a risk of death or serious harm, write with "Emergency" in the subject. We review emergency requests first.'),
      ] },
      { heading: 'Preservation', blocks: [
        p('We can preserve account records while you obtain the legal process required.'),
      ] },
    ],
  },
];

/** A document with its placeholders filled in. */
export function legalDocument(slug: string): (LegalDocument & { version: number; updated: string }) | null {
  const found = DOCUMENTS.find((doc) => doc.slug === slug);
  if (!found) return null;
  const { supportEmail, grievanceOfficer } = legalConfig();
  const fill = (text: string) => text.split('{{SUPPORT_EMAIL}}').join(supportEmail).split('{{GRIEVANCE_OFFICER}}').join(grievanceOfficer);
  return {
    ...found,
    version: LEGAL_VERSION,
    updated: LEGAL_UPDATED,
    sections: found.sections.map((section) => ({
      heading: section.heading,
      blocks: section.blocks.map((block) => (block.type === 'list' ? { type: 'list', items: block.items.map(fill) } : { ...block, text: fill(block.text) })),
    })),
  };
}

export const legalIndex = () => DOCUMENTS.map(({ slug, title, summary }) => ({ slug, title, summary }));
