// Shared choices for onboarding and the preference UI. Keep the stored IDs unchanged.

export const LIFESTYLE_SECTIONS = [
  {
    id: "drink",
    title: "How often do you drink?",
    icon: "glass-wine",
    options: [
      { id: "not_for_me", label: "Not for me" },
      { id: "newly_teetotal", label: "Newly teetotal" },
      { id: "sober_curious", label: "Sober curious" },
      { id: "special_occasions", label: "On special occasions" },
      { id: "socially", label: "Socially, at the weekend" },
      { id: "most_nights", label: "Most nights" },
    ],
  },
  {
    id: "smoke",
    title: "How often do you smoke?",
    icon: "cigar",
    options: [
      { id: "social_smoker", label: "Social smoker" },
      { id: "smoker_drinking", label: "Smoker when drinking" },
      { id: "non_smoker", label: "Non-smoker" },
      { id: "smoker", label: "Smoker" },
      { id: "trying_to_quit", label: "Trying to quit" },
    ],
  },
  {
    id: "exercise",
    title: "Do you exercise?",
    icon: "dumbbell",
    options: [
      { id: "every_day", label: "Every day" },
      { id: "often", label: "Often" },
      { id: "sometimes", label: "Sometimes" },
      { id: "never", label: "Never" },
    ],
  },
  {
    id: "pets",
    title: "Do you have any pets?",
    icon: "paw",
    options: [
      { id: "dog", label: "Dog" },
      { id: "cat", label: "Cat" },
      { id: "reptile", label: "Reptile" },
      { id: "amphibian", label: "Amphibian" },
      { id: "bird", label: "Bird" },
      { id: "fish", label: "Fish" },
      { id: "love_pets", label: "Don't have, but love" },
      { id: "other", label: "Other" },
      { id: "turtle", label: "Turtle" },
      { id: "hamster", label: "Hamster" },
      { id: "rabbit", label: "Rabbit" },
      { id: "pet_free", label: "Pet-free" },
      { id: "all_pets", label: "All the pets" },
      { id: "want_pet", label: "Want a pet" },
      { id: "allergic", label: "Allergic to pets" },
    ],
  },
];

export const PERSONALITY_SECTIONS = [
  {
    id: "communication",
    title: "What's your communication style?",
    icon: "message-text-outline",
    options: [
      { id: "whatsapp_all_day", label: "I stay on WhatsApp all day" },
      { id: "big_time_texter", label: "Big time texter" },
      { id: "phone_caller", label: "Phone caller" },
      { id: "video_chatter", label: "Video chatter" },
      { id: "slow_to_answer", label: "I'm slow to answer on WhatsApp" },
      { id: "bad_texter", label: "Bad texter" },
      { id: "better_in_person", label: "Better in person" },
    ],
  },
  {
    id: "love_reception",
    title: "How do you receive love?",
    icon: "heart-outline",
    options: [
      { id: "thoughtful_gestures", label: "Thoughtful gestures" },
      { id: "presents", label: "Presents" },
      { id: "touch", label: "Touch" },
      { id: "compliments", label: "Compliments" },
      { id: "time_together", label: "Time together" },
    ],
  },
  {
    id: "education",
    title: "What is your education level?",
    icon: "school-outline",
    options: [
      { id: "bachelor", label: "Bachelor degree" },
      { id: "at_uni", label: "At uni" },
      { id: "high_school", label: "High school" },
      { id: "phd", label: "PhD" },
      { id: "graduate_programme", label: "On a graduate programme" },
      { id: "master", label: "Master degree" },
      { id: "trade_college", label: "Trade college" },
    ],
  },
  {
    id: "star_sign",
    title: "What's your star sign?",
    icon: "moon-waning-crescent",
    options: [
      { id: "capricorn", label: "Capricorn" },
      { id: "aquarius", label: "Aquarius" },
      { id: "pisces", label: "Pisces" },
      { id: "aries", label: "Aries" },
      { id: "taurus", label: "Taurus" },
      { id: "gemini", label: "Gemini" },
      { id: "cancer", label: "Cancer" },
      { id: "leo", label: "Leo" },
      { id: "virgo", label: "Virgo" },
      { id: "libra", label: "Libra" },
      { id: "scorpio", label: "Scorpio" },
      { id: "sagittarius", label: "Sagittarius" },
    ],
  },
  {
    id: "personality",
    title: "How would you describe your personality?",
    icon: "account-outline",
    options: [
      { id: "introvert", label: "Introvert" },
      { id: "extrovert", label: "Extrovert" },
      { id: "ambivert", label: "Ambivert" },
      { id: "chill", label: "Chill" },
      { id: "energetic", label: "Energetic" },
    ],
  },
];

// Checked against the official IEM/UEM Kolkata programme lists on 2026-10-06.
// Sources: https://exam.iem.edu.in/, https://iem.edu.in/courses/,
// https://uem.edu.in/uem-kolkata/courses/
// Keep existing options for students from earlier batches. Do not encode durations:
// the current admissions portal and older departmental pages differ on durations.
export const ACADEMIC_COURSES = [
  {
    title: "Undergraduate (B.Tech)",
    courses: [
      "Computer Science & Engineering (CSE)",
      "CSE (AI & ML)",
      "CSE (Artificial Intelligence)",
      "CSE (Data Science)",
      "CSE (Artificial Intelligence & Data Science)",
      "CSE (Cyber Security)",
      "CSE (IoT, Cyber Security & Blockchain)",
      "CSE (Internet of Things)",
      "Computer Science & Business Systems (CSBS)",
      "Computer Science & Information Technology (CSIT)",
      "Computer Science & Technology (CST)",
      "Information Technology (IT)",
      "Electronics & Communication Engineering (ECE)",
      "Electrical Engineering (EE)",
      "Electrical & Electronics Engineering (EEE)",
      "Mechanical Engineering (ME)",
      "Biotechnology",
    ],
  },
  {
    title: "Other Undergraduate",
    courses: [
      "BBA",
      "BCA",
      "BBA LLB (Hons)",
      "Bachelor of Hotel Management (BHMCT)",
      "Bachelor of Hotel & Hospitality Management (BHM)",
      "B.Sc in Hospitality & Hotel Admin",
    ],
  },
  {
    title: "Postgraduate",
    courses: [
      "MBA / General Management",
      "MBA (Human Resources Management)",
      "MBA (Marketing Management)",
      "MBA (Finance Management)",
      "MBA (Systems Management)",
      "MBA (Supply Chain & Logistics Management)",
      "MBA (Retail Management)",
      "MBA (Digital Marketing Management)",
      "MBA (Event Management)",
      "MBA (Technology Management)",
      "MBA (Entrepreneurship & Family Business)",
      "MCA",
      "M.Tech in CSE",
      "M.Tech in CSE (AI & ML)",
      "M.Tech in ECE",
      "M.Tech in CSBS",
      "MS in Microbiology",
      "MS in Molecular Biology",
      "MS in Bioinformatics",
    ],
  },
  {
    title: "Doctoral (Ph.D)",
    courses: [
      "Ph.D in Computer Science & Engineering",
      "Ph.D in Electronics & Communication Engineering",
      "Ph.D in Electrical Engineering",
      "Ph.D in Mechanical Engineering",
      "Ph.D in Information Technology",
      "Ph.D in Biotechnology",
      "Ph.D in Management",
      "Ph.D in Physics",
      "Ph.D in Chemistry",
      "Ph.D in Mathematics",
      "Ph.D in Biological Science",
      "Ph.D in English",
    ],
  },
];

// Map earlier labels to the same programme, rather than creating duplicate choices.
export function normalizeAcademicCourse(value: string): string {
  const previous: Record<string, string> = {
    'CSE (IoT & Cyber Security)': 'CSE (IoT, Cyber Security & Blockchain)',
    'Computer Science & Business Systems': 'Computer Science & Business Systems (CSBS)',
    'BBA (3 years)': 'BBA',
    'BCA (3 years)': 'BCA',
    'BBA LLB (Hons) (5 years)': 'BBA LLB (Hons)',
  };
  return previous[value] ?? value;
}

export const DEGREE_OPTIONS = ['B.Tech', 'M.Tech', 'BBA', 'BCA', 'BBA LLB (Hons)', 'BHMCT', 'BHM', 'B.Sc', 'MBA', 'MCA', 'MS', 'Ph.D', 'B.Des'] as const;

export const DATING_INTENTIONS = [
    { id: 'Long-term partner', title: 'Long-term partner', emoji: '💘' },
    { id: 'Long-term, but short-term OK', title: 'Long-term, but short-term OK', emoji: '😍' },
    { id: 'Short-term, but long-term OK', title: 'Short-term, but long-term OK', emoji: '🥂' },
    { id: 'Short-term fun', title: 'Short-term fun', emoji: '🎉' },
    { id: 'New friends', title: 'New friends', emoji: '👋' },
    { id: 'Still figuring it out', title: 'Still figuring it out', emoji: '🤔' },
  ];

export const ORIENTATION_OPTIONS = [
    { id: 'Straight', label: 'Straight', description: 'A person who is exclusively attracted to members of the opposite gender' },
    { id: 'Gay', label: 'Gay', description: 'An umbrella term used to describe someone who is attracted to members of their gender' },
    { id: 'Lesbian', label: 'Lesbian', description: 'A woman who is emotionally, romantically, or sexually attracted to other women and non-binary people' },
    { id: 'Bisexual', label: 'Bisexual', description: 'A person who has potential for emotional, romantic or sexual attraction to people of more than one gender' },
    { id: 'Asexual', label: 'Asexual', description: 'A person who may not experience sexual attraction or may experience a limited amount of sexual desire. May still experience romantic attraction or desire' },
    { id: 'Demisexual', label: 'Demisexual', description: 'A person who does not experience sexual attraction unless they form a strong emotional connection. May still experience romantic attraction or desire' },
    { id: 'Pansexual', label: 'Pansexual', description: 'A person who has potential for emotional, romantic or sexual attraction to people regardless of gender' },
    { id: 'Queer', label: 'Queer', description: 'An umbrella term used to express a spectrum of sexual orientations and genders often used to include those who do not identify as exclusively heterosexual' },
    { id: 'Bicurious', label: 'Bicurious', description: '' },
    { id: 'Aromantic', label: 'Aromantic', description: 'A person who does not experience romantic attraction, although they may still experience sexual attraction' },
  ];

export const PROFILE_CLUBS = ["Robotics", "Tech/Coding", "Music/Band", "Dance", "Drama", "Sports", "Photography", "Debate"];

export const ATTENDANCE_STYLES = ["75% Maintainer", "Front Bencher", "Bunker", "Risk Taker"];


export const GENDER_OPTIONS = [
    { id: 'Man', label: 'Man' },
    { id: 'Woman', label: 'Woman' },
    { id: 'Beyond binary', label: 'Beyond binary' },
  ];

export const GENDER_DETAILS: Record<string, { label: string; description: string }[]> = {
    'Man': [
      { label: 'Cis man', description: 'A man whose gender aligns with the sex they were assigned at birth.' },
      { label: 'Intersex man', description: "A man born with variations of sex characteristics that don't fit into the binary categorisation of male and female bodies" },
      { label: 'Trans man', description: 'A man who is transgender and whose gender is different from the sex assigned to them at birth.' },
      { label: 'Transmasculine', description: 'A person who was assigned female at birth, but presents as masculine and identifies with masculinity. This person may or may not see themselves as a man or a transgender man.' },
    ],
    'Woman': [
      { label: 'Cis woman', description: 'A woman whose gender aligns with the sex they were assigned at birth.' },
      { label: 'Intersex woman', description: "A woman born with variations of sex characteristics that don't fit into the binary categorisation of male and female bodies" },
      { label: 'Trans woman', description: 'A woman who is transgender and whose gender is different from the sex assigned to them at birth.' },
      { label: 'Transfeminine', description: 'A person who was assigned male at birth, but presents as feminine and identifies with femininity. This person may or may not see themselves as a woman or a transgender woman.' },
    ],
    'Beyond binary': [
      { label: 'Agender', description: 'A person who does not have a gender.' },
      { label: 'Bigender', description: 'A person who has two or more genders (can be simultaneously or fluid between them).' },
      { label: 'Gender fluid', description: 'A person who does not have a single fixed gender.' },
      { label: 'Gender questioning', description: 'A person who is questioning their current gender and/or exploring.' },
      { label: 'Genderqueer', description: 'A person who does not identify or express their gender within the gender binary.' },
      { label: 'Intersex', description: "An umbrella term that refers to people born with variations in sex characteristics that don't fit binary categorisation of male and female" },
      { label: 'Non-binary', description: 'A person whose gender is beyond the exclusive categories of man and woman.' },
      { label: 'Pangender', description: 'A person who experiences multiple genders either simultaneously or' },
      { label: 'Trans person', description: 'A person who is transgender and whose gender is different from the sex assigned to them at birth.' },
      { label: 'Transfeminine', description: 'A person who was assigned male at birth, but presents as feminine and identifies with femininity. This person may or may not see themselves as a woman or a transgender woman.' },
      { label: 'Transmasculine', description: 'A person who was assigned female at birth, but presents as masculine and identifies with masculinity. This person may or may not see themselves as a man or a transgender man.' },
      { label: 'Two-spirit', description: 'An umbrella term used by those belonging to US Native American and Canadian First Nations communities to honour the sacred role that people who are not exclusively cisgender and/or heterosexual hold.' },
    ]
  };

export const GRADUATION_YEARS = Array.from({ length: 13 }, (_, index) => 2020 + index);
