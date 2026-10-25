# IEM Connect: safety, reporting and legal checklist

What a dating app in India needs: blocking and reporting, other safety tools,
the laws that apply, the app stores' rules, and the documents to publish. Each
item is marked against what the app has today.

**Not legal advice.** This is research from public sources (listed at the
end). Before launch, have an Indian technology lawyer check the published
documents and the grievance process.

**Status:** ✅ done · 🟡 partly done · ❌ missing (updated 24 Oct 2026 after the first build; how each is run: [SAFETY_PROCESSES.md](SAFETY_PROCESSES.md))

---

## 1. Block

What the big apps do: a block is instant, silent (the other person is not
told), works from everywhere the person appears, and hides each person from the
other completely.

| Feature | What it means | Status |
|---|---|---|
| Block from a profile, a chat, Likes You, Search, Stories | One tap wherever the person appears | 🟡 chat info has it; check every other entry point |
| Silent | The blocked person is never told | ✅ |
| Hidden both ways | Neither sees the other in Explore, Search, Likes, Stories, the Map, Standouts | ✅ server hides blocked pairs (check each surface once) |
| The chat closes | Messages stop both ways; the match goes | ✅ |
| Block and report together | "Block and report" as one step, the way Bumble does | ✅ "Also block" in the report sheet |
| Blocked list with Unblock | Settings > Blocked accounts | ✅ |
| Block someone you haven't matched | From their profile in Search or Explore | 🟡 check |
| Block by phone contact or email | Tinder's "Block contacts": never see people you know | ❌ optional |
| A block survives unmatch and re-signup | Keyed to the person, not the match | ✅ the block is by user |

## 2. Report

### 2.1 One list of reasons, everywhere

The app has three different 4-item lists, the chat report has no reasons at
all, and stories send one fixed reason. Use one list on every screen, with a
second step for detail. These are the reasons Bumble, Tinder and Hinge use:

| Reason | Second step (examples) | Priority |
|---|---|---|
| **Under 18** | - | Urgent: hidden at once (✅ built) |
| **Fake profile or not them** | Photos of someone else · Catfish · Celebrity / stolen photos | High |
| **Scam or selling** | Asking for money · Investment / crypto · Selling sex or services · Promoting accounts or links | High |
| **Harassment or threats** | Bullying · Threats · Stalking · Won't stop messaging | High |
| **Sexual content** | Nude photos sent without asking · Sexual messages · Explicit profile | High |
| **Hate or discrimination** | Caste, religion, race, gender, sexuality, disability | High |
| **Violence or offline harm** | Something happened on a date · Assault · Unsafe meeting | Urgent |
| **Intimate images shared without consent** | Of me · Of someone else | Urgent (24-hour removal in India, see 5.1) |
| **Self-harm** | They may be at risk | Urgent - show helplines too |
| **Spam or bot** | - | Normal |
| **Not a student at this college** | - | Normal |
| **Something else** | Free text | Normal |

### 2.2 Where reporting must be possible

| From | Status |
|---|---|
| A profile (Explore, Search, Standouts, Likes You) | ✅ one report sheet |
| A single message in a chat (long press) | ✅ |
| Chat info | ✅ |
| A story | ✅ |
| A Rose note | ✅ server supports it |
| **After unmatching or blocking** (Tinder lets you report from the match list later) | ✅ Settings > Safety and help > Report someone |
| **Someone who blocked or unmatched you** | ✅ same list |
| **Offline incidents**, by a web form or email (name, age, college, what happened) | ✅ by email from Report someone |

### 2.3 How the report flow should feel

- Reason → optional detail (up to 2000 characters) → **"Also block them?"**
  (on by default) → "Thanks, we'll look at this". Under 30 seconds.
- Never tell the reported person who reported them. ✅
- Save the evidence at the moment of the report (the message, photo, story,
  note) even if it is deleted later. ✅ messages, stories, Roses, and the profile
  (name, bio, photos) as it was.
- Tell the reporter the outcome ("we acted" or "we reviewed"), never the
  details. ✅
- An urgent report gets a safety screen: helplines (112, women's helpline 181,
  cyber crime 1930), how to report to the police, and "If you're in danger, call 112". ✅

### 2.4 After a report (moderation)

| Item | Status |
|---|---|
| One case per person, all reports in it, most urgent first | ✅ |
| Under-18 hides the profile at once | ✅ |
| Three different reporters hide the profile | ✅ |
| Warn, hide, suspend, ban with a reason | ✅ admin panel |
| A ban blocks the same Google account, emails, college email and phone | ✅ |
| Audit log of every staff action | ✅ |
| **Appeal**: a banned or hidden person can ask for a second look, with a reply within 15 days | ✅ told why at sign-in; `/appeal` page; Appeals queue in the panel; the decision is emailed |
| **Response time target**: under 24 hours for every report (Apple expects it; IT Rules, see 5.1) | 🟡 tooling yes; needs someone watching the queue daily |
| Report repeat offenders and serial reporters (fake reports) | ✅ case history and each reporter's dismissed share, in the admin panel |

## 3. Other safety tools the big apps have

| Tool | Who has it | What it does | Status |
|---|---|---|---|
| Unmatch | All | Ends the chat for both | ✅ |
| Photo selfie verification | Tinder, Bumble, Hinge | Blue badge | ✅ selfie check + college email |
| Hidden Words | Hinge | Filter words and emojis out of incoming likes and messages | ✅ messages and Rose notes |
| "Does This Bother You?" | Tinder | Asks the receiver after an offensive message, one tap to report | ✅ |
| "Are You Sure?" | Tinder | Asks the sender before sending an offensive message | ✅ |
| Explicit image blur | Bumble (Private Detector) | Nude images arrive blurred, with "View" / "Report" | ✅ Freepik nsfw_image_detector (MIT) on our own face service - chat, profile and Stories ([NUDITY_CHECK.md](NUDITY_CHECK.md)) |
| Safety Centre | All | Tips, guidelines, helplines, how to report, in the app | ✅ |
| Date check-in / share my date | Tinder, Hinge (Save my date) | Share who, where and when with a friend | ✅ Chat info > Share date plans |
| Scam warnings | All | "Never send money" note when money, crypto or a payment link appears | ✅ |
| Links and phone numbers in first messages | Several | Warned about, or blocked until both have replied | ✅ warned (the scam note); not blocked |
| Pause / hide profile | All | Leave Discovery without deleting | ✅ (hidden at a place; check a general pause) |
| Location privacy | All | Approximate distance only, never the exact spot | ✅ |
| Screenshot block on Stories | - | Optional | ✅ |
| Stop being shown to people you know | Bumble | Hide from contacts / your own college department | ❌ optional |

## 4. App store rules

### 4.1 Google Play

| Requirement | Status |
|---|---|
| **Child Safety Standards** (Social and Dating apps, self-certified in Play Console): 1) published standards that ban child sexual abuse and exploitation (CSAE); 2) an in-app way to report; 3) remove CSAM when you learn of it; 4) report confirmed CSAM to the authorities (in India, the police / cybercrime.gov.in); 5) a named contact person for Google | 🟡 2 and 3 work; 1, 4 and 5 are missing |
| **Account deletion**: in the app ✅ **and** a web page where people can ask for deletion without the app | ✅ `/account/delete` |
| **Data safety form**: what data is collected, why, shared or not, encrypted, deletable | ❌ fill in before release |
| **Target audience 18+**: dating apps must be adults only | ✅ birthday check; set it in Play Console |
| **Prominent disclosure** before location, camera, contacts and the face check | 🟡 face check yes; check location |
| **User-generated content**: report, block, rules in the Terms | 🟡 |

### 4.2 Apple App Store (Guideline 1.2)

| Requirement | Status |
|---|---|
| A way to filter objectionable content | 🟡 moderation yes; no filter (Hidden Words, image blur) |
| A way to report, with a timely response (reviewers ask for action **within 24 hours**) | 🟡 |
| A way to block abusive users | ✅ |
| Published contact information | ✅ support email in the app and on every web page |
| Users must accept Terms (EULA) that forbid objectionable content, before using the app | ✅ onboarding "I agree", and a gate for existing accounts |
| No "hookup" positioning or anything facilitating prostitution (1.1.4) | ✅ keep the store text clean |

## 5. Indian law

### 5.1 IT Act 2000 and the IT Rules 2021 (intermediaries)

The app is an intermediary: it hosts what users post. To keep "safe harbour"
(not being liable for users' posts) it must:

| Duty | Status |
|---|---|
| Publish Terms, a Privacy Policy and user rules, and tell users at least once a year | ✅ published; a yearly in-app reminder |
| Appoint a **Grievance Officer**: name and contact published in the app and on the website | 🟡 page and email ready; the officer's name is still to be added (`GRIEVANCE_OFFICER`) |
| Acknowledge a complaint within **24 hours**, resolve it within **15 days** | 🟡 promised and written down (SAFETY_PROCESSES.md); someone must watch the inbox |
| Remove content showing a person nude or in a sexual act, or impersonating them, within **24 hours** of their complaint | 🟡 tools yes; needs the report reason and the process |
| Remove content on a court or government order within the deadline | ✅ process written |
| Keep information on removed content and banned accounts for 180 days for investigations | 🟡 audit log; check retention |
| Help law enforcement when legally asked (a law-enforcement contact and process) | ✅ Law Enforcement Guidelines + process |
| Users who disagree with the grievance officer can appeal to the Grievance Appellate Committee within 30 days: say so in the policy | ✅ |

### 5.2 Digital Personal Data Protection Act 2023 and the DPDP Rules 2025

The Rules were notified in November 2025. Most duties apply from about
**May 2027**; build them now.

| Duty | What it means for the app | Status |
|---|---|---|
| **Notice** | Before collecting: what data, why, how to use your rights, how to complain - itemised, plain language, in English and on request in Indian languages | ✅ Privacy Policy (English) |
| **Consent** | A clear "I agree" at sign-up, per purpose; nothing pre-ticked | 🟡 "I agree" recorded with its version; per-purpose switches not yet |
| **Withdraw consent** as easily as giving it | Switches in Settings; withdrawal deletes that data | 🟡 delete account yes; per-purpose no |
| **Right to access** | A summary of your data | ✅ Export my data |
| **Right to correct and erase** | Edit profile; delete account | ✅ |
| **Right to nominate** someone to act if you die or can't | A field in Settings > Account | ✅ Settings > Account > Nominee |
| **Grievances** | Answer within a reasonable time, at most 90 days (7 days is good practice); publish the contact | ✅ 15-day promise, contact published |
| **Security** | Encryption, access control, logging | 🟡 check and write down |
| **Breach** | Tell affected users and the Data Protection Board at once; a full report within 72 hours | ✅ plan written |
| **Retention** | Delete data once its purpose ends; tell people 48 hours before deleting an inactive account; keep processing logs for a year | 🟡 deletion yes; schedule no |
| **Children under 18** | Their data needs verifiable parental consent, and no tracking or targeted ads. A dating app must keep under-18s out instead | ✅ 18+ birthday check; ✅ under-18 reports hide at once |
| **Face data** | The selfie check makes a face key from biometric data: say so in the notice, get explicit consent, keep it encrypted, delete it on request | 🟡 consent screen and encryption yes; needs the policy text |

Penalties reach ₹250 crore for weak security and ₹200 crore for children's data.

**For IEM in particular:** some first-year students are 17. The birthday check
must stay strict, and the college email alone must never be treated as
proof of age.

### 5.3 Child protection: POCSO Act 2012 and IT Act 67B

| Duty | Status |
|---|---|
| Child sexual abuse material is a crime to host, view or share; remove it at once | 🟡 tools yes |
| **Report it to the police** (POCSO section 19), not only remove it. The Supreme Court held (2024) that platforms lose safe harbour if they don't | ✅ process written (SAFETY_PROCESSES.md) |
| Never forward or store copies except as the law requires for the report | ✅ process written |

### 5.4 Other laws worth naming in the Community Guidelines

Stalking, sexual harassment and voyeurism (Bharatiya Nyaya Sanhita),
obscene content (IT Act 67, 67A), identity theft and impersonation (IT Act
66C, 66D), and caste-based abuse (SC/ST Act).

## 6. Documents to publish

All in the app (Settings > About) and on a public web page.

| Document | Contents | Status |
|---|---|---|
| **Terms of Service** | 18+ only; students of partner colleges; account rules; what is banned; moderation, suspension and bans; appeals; liability; governing law (India) | ✅ |
| **Privacy Policy** | Every piece of data, why, how long, who it's shared with (storage, email, push providers); face data; location; rights and how to use them; grievance contact | ✅ |
| **Community Guidelines** | What is not allowed, in plain words, with examples; what happens when broken | ✅ |
| **Child Safety Standards (CSAE)** | Zero tolerance; how to report; removal and reporting to authorities; contact person (Google Play requires this) | ✅ |
| **Grievance Redressal** | Grievance Officer's name, email, address; 24-hour acknowledgement and 15-day resolution; how to appeal | 🟡 officer name to add |
| **Account and data deletion page** | A web form to ask for deletion without the app (Google Play) | ✅ |
| **Safety Centre** | Dating safety tips, scams, meeting safely, helplines, how to report | ✅ |
| **Law enforcement guidelines** | How police can request information, and the contact | ✅ |

Sign-up should show "By continuing you agree to the Terms and Privacy
Policy", with links, before the account is made. The face check should link to
the face-data part of the Privacy Policy.

## 7. What to do, in order

**Before launch (must have)**
1. Terms, Privacy Policy, Community Guidelines, Child Safety Standards, all linked in the app and on the web.
2. Sign-up consent ("I agree to the Terms and Privacy Policy") and the face-data consent text.
3. A Grievance Officer and a support email, published; acknowledge in 24 hours, resolve in 15 days.
4. One list of report reasons everywhere, with detail, "also block", and reporting after unmatch.
5. Reporting a single message from the chat (check the long-press menu).
6. A web page for account deletion requests.
7. Written processes: CSAM (remove, keep evidence, report to police), intimate images (24 hours), law-enforcement requests, data breach (72 hours).
8. Google Play: Data safety form, Child Safety Standards declaration with a contact person, target audience 18+.
9. Someone checks the admin panel's queues every day (24-hour target).

**Soon after**
10. Safety Centre with helplines; a safety screen after urgent reports.
11. Appeals for hidden, suspended and banned accounts.
12. ✅ Explicit image blur in chat (and the check on profile media and Stories).
13. Scam and link warnings in first messages.
14. Nominee field and per-purpose consent switches (DPDP, before May 2027).
15. Retention schedule: inactive accounts, logs, face keys, evidence.

**Later**
16. Hidden Words, "Does this bother you?", "Are you sure?".
17. Share-my-date check-in.
18. Block contacts.

---

## Sources

- [Bumble: When to report someone](https://support.bumble.com/hc/en-us/articles/33168388471965-When-to-report-someone)
- [Bumble: reporting catfish and hate speech](https://bumble.com/the-buzz/bumble-how-to-report-catfish-hate-speech)
- [Tinder Safety Centre: how to report](https://policies.tinder.com/safety-center/tools/how-to-report/intl/ml/)
- [TechCrunch: Tinder reporting after unmatch](https://techcrunch.com/2020/12/07/tinder-makes-it-easier-to-report-bad-actors-using-unmatch-to-hide-from-victims)
- [TechCrunch: Hinge Hidden Words](https://techcrunch.com/2024/04/24/hinge-adds-a-filter-for-words-and-phrases-you-want-to-avoid-while-getting-matches)
- [Fox: Tinder and Hinge safety features](https://www.foxla.com/news/tinder-hinge-safety-feature-save-my-date-hidden-words)
- [Cybernews: Hinge Hidden Words](https://cybernews.com/news/hinge-hidden-words-feature/)
- [Google Play: Child Safety Standards policy](https://support.google.com/googleplay/android-developer/answer/14585136?authuser=2)
- [Google Play: child safety help article](https://support.google.com/googleplay/android-developer/answer/16549787?hl=en)
- [Google Play: User-generated content](https://support.google.com/googleplay/android-developer/answer/9878809)
- [iubenda: Child Safety Standards policy](https://www.iubenda.com/en/blog/child-safety-standards-policy/)
- [Google Play: account deletion requirements](https://support.google.com/googleplay/android-developer/answer/13327111)
- [Android Developers: account and data deletion](https://android-developers.googleblog.com/2023/04/giving-people-more-control-over-their-data.html?hl=en)
- [Apple: App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Apple forums: Guideline 1.2 rejections](https://developer.apple.com/forums/thread/807358)
- [SCC Online: DPDP Rules 2025 highlights](https://www.scconline.com/blog/post/2025/12/26/digital-personal-data-protection-rules-2025-key-highlights/)
- [EY: DPDP Rules 2025](https://www.ey.com/en_in/insights/cybersecurity/transforming-data-privacy-digital-personal-data-protection-rules-2025)
- [Lawrbit: DPDP Rules 2025](https://lawrbit.com/article/digital-personal-data-protection-rules-2025)
- [IIT BHU: DPDP Act and Rules summary](https://iitbhu.ac.in/contents/institute/cf/cis/doc/dpdp_act_rules_summary.pdf)
- [miniOrange: data principal rights](https://www.miniorange.com/blog/data-principal-rights-under-dpdp-act/)
- [Tsaaro: rights and duties of the data principal](https://tsaaro.com/?p=37043)
- [KPMG: DPDP Act overview](https://assets.kpmg.com/content/dam/kpmg/in/pdf/2023/08/digital-personal-data-protection-act-2023-overview.pdf)
- [Drishti IAS: IT Rules 2021](https://www.drishtiias.com/daily-updates/daily-news-analysis/information-technology-rules-2021-2/print_manually)
- [Deccan Herald: the IT Rules explained](https://www.deccanherald.com/amp/national/explained-what-are-the-new-rules-on-social-media-1157629.html)
- [Internet Freedom Foundation: Grievance Appellate Committee](https://www.internetfreedom.in/the-delhi-high-court-directs-the-grievance-appellate-committee-to-dispose-appeal-in-30-days/)
- [JGU Child Rights Clinic: Supreme Court on POCSO and the IT Act](https://jgu.edu.in/child-rights-clinic/viewing-and-storing-child-pornography-are-offences-under-pocso-and-its-act-sc/)
- [IPRMENTLAW: POCSO compliance and safe harbour](https://iprmentlaw.com/?p=8390)
- [DT Next: NHRC on Section 19 reporting](https://www.dtnext.in/news/national/nhrc-takes-cognisance-of-paid-ads-on-meta-platform-promoting-access-to-child-sexual-abuse-material)
- [Eastern Mirror: Supreme Court on CSEAM reporting](https://www.easternmirrornagaland.com/sc-flags-lapses-linked-to-child-abuse-content-on-social-media-seeks-centres-response)
