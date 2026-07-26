import type { CourseLevel, CourseMode } from '@course-lms/shared';

export interface SeedCategory {
  name: string;
  slug: string;
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { name: 'Technology', slug: 'technology' },
  { name: 'Design', slug: 'design' },
  { name: 'Data & AI', slug: 'data-ai' },
  { name: 'Business', slug: 'business' },
  { name: 'Marketing', slug: 'marketing' },
  { name: 'Languages', slug: 'languages' },
];

export interface SeedInstructor {
  name: string;
  title: string;
  bio: string;
}

export interface SeedBatch {
  label: string;
  startDate: string;
  endDate: string;
  days: string;
  time: string;
  seatsTotal: number;
  seatsAvailable: number;
}

export interface SeedCourse {
  name: string;
  slug: string;
  categorySlug: string;
  mode: CourseMode;
  level: CourseLevel;
  durationWeeks: number;
  price: number;
  originalPrice: number | null;
  hasCertificate: boolean;
  rating: number | null;
  enrollmentSeed: number;
  shortDescription: string;
  fullDescription: string;
  learningOutcomes: string[];
  instructor: SeedInstructor;
  batches: SeedBatch[];
}

/**
 * Seeded courses ship with no image. The kiosk draws a deterministic gradient
 * cover from the course slug instead, so the catalogue renders correctly with
 * no network — a hard requirement for an offline-capable kiosk. Real artwork
 * arrives via the admin image upload, which sets a local /uploads/… URL.
 */
export const courseImage = (_slug: string): string => "";

export const SEED_COURSES: SeedCourse[] = [
  {
    name: 'Full-Stack Web Development',
    slug: 'full-stack-web-development',
    categorySlug: 'technology',
    mode: 'offline',
    level: 'intermediate',
    durationWeeks: 16,
    price: 45000,
    originalPrice: 55000,
    hasCertificate: true,
    rating: 4.8,
    enrollmentSeed: 312,
    shortDescription:
      'Build and deploy complete web applications with React, Node.js and PostgreSQL.',
    fullDescription:
      'A hands-on, project-driven programme that takes you from HTML fundamentals to deploying production applications. You will build eight real projects, work with a version-controlled team codebase, and finish with a portfolio-ready capstone application reviewed by industry mentors. The curriculum covers modern React with hooks, REST and GraphQL API design, relational data modelling, authentication, testing and CI/CD.',
    learningOutcomes: [
      'Build responsive interfaces with React and modern CSS',
      'Design and implement REST and GraphQL APIs in Node.js',
      'Model relational data and write efficient PostgreSQL queries',
      'Implement secure authentication and role-based access control',
      'Write unit and integration tests with confidence',
      'Deploy applications with Docker and automated CI/CD pipelines',
    ],
    instructor: {
      name: 'Arjun Menon',
      title: 'Principal Engineer, ex-Flipkart',
      bio: 'Twelve years building consumer-scale web platforms. Has mentored over 600 developers into their first engineering roles.',
    },
    batches: [
      {
        label: 'August Weekday Batch',
        startDate: '2026-08-10',
        endDate: '2026-11-30',
        days: 'Mon, Wed, Fri',
        time: '18:00 - 20:30',
        seatsTotal: 30,
        seatsAvailable: 7,
      },
      {
        label: 'September Weekend Batch',
        startDate: '2026-09-05',
        endDate: '2027-01-16',
        days: 'Sat, Sun',
        time: '10:00 - 14:00',
        seatsTotal: 30,
        seatsAvailable: 22,
      },
    ],
  },
  {
    name: 'Python Programming Fundamentals',
    slug: 'python-programming-fundamentals',
    categorySlug: 'technology',
    mode: 'online',
    level: 'beginner',
    durationWeeks: 6,
    price: 12000,
    originalPrice: null,
    hasCertificate: true,
    rating: 4.7,
    enrollmentSeed: 528,
    shortDescription:
      'Start from zero and write real Python programs in six focused weeks.',
    fullDescription:
      'Designed for absolute beginners, this course builds programming intuition before syntax. Every session pairs a short concept explanation with live coding, and every week ends with a small buildable project. By the end you will be comfortable reading and writing Python, automating repetitive tasks, and working with files and external APIs.',
    learningOutcomes: [
      'Read and write clear, idiomatic Python',
      'Work confidently with lists, dictionaries and comprehensions',
      'Handle files, JSON and CSV data',
      'Consume REST APIs with the requests library',
      'Structure code into reusable functions and modules',
      'Debug errors methodically instead of by guesswork',
    ],
    instructor: {
      name: 'Priya Raghavan',
      title: 'Senior Python Developer',
      bio: 'Automation specialist who has taught Python to more than 2,000 students across corporate and academic settings.',
    },
    batches: [
      {
        label: 'Evening Online Batch',
        startDate: '2026-08-03',
        endDate: '2026-09-14',
        days: 'Tue, Thu',
        time: '19:00 - 21:00',
        seatsTotal: 60,
        seatsAvailable: 31,
      },
      {
        label: 'Morning Online Batch',
        startDate: '2026-08-17',
        endDate: '2026-09-28',
        days: 'Mon, Wed',
        time: '07:00 - 09:00',
        seatsTotal: 60,
        seatsAvailable: 44,
      },
    ],
  },
  {
    name: 'UI/UX Design Masterclass',
    slug: 'ui-ux-design-masterclass',
    categorySlug: 'design',
    mode: 'online',
    level: 'intermediate',
    durationWeeks: 10,
    price: 28000,
    originalPrice: 34000,
    hasCertificate: true,
    rating: 4.9,
    enrollmentSeed: 274,
    shortDescription:
      'Design products people love — research, wireframes, prototypes and design systems.',
    fullDescription:
      'A complete product design curriculum taught the way real teams work. You will run user interviews, synthesise findings into problem statements, sketch and test low-fidelity flows, then build a polished high-fidelity prototype in Figma. The final three weeks focus on design systems: tokens, components, documentation and developer handoff.',
    learningOutcomes: [
      'Plan and run effective user research sessions',
      'Translate findings into user flows and information architecture',
      'Wireframe and prototype rapidly in Figma',
      'Build a reusable component library with design tokens',
      'Run usability tests and iterate on real feedback',
      'Hand off to engineers with specs that survive implementation',
    ],
    instructor: {
      name: 'Fatima Al-Sayed',
      title: 'Lead Product Designer',
      bio: 'Designs fintech products used across the GCC. Speaks regularly on accessible and bilingual interface design.',
    },
    batches: [
      {
        label: 'Weekend Studio Batch',
        startDate: '2026-08-15',
        endDate: '2026-10-25',
        days: 'Sat, Sun',
        time: '11:00 - 13:30',
        seatsTotal: 25,
        seatsAvailable: 9,
      },
    ],
  },
  {
    name: 'Data Science & Machine Learning',
    slug: 'data-science-machine-learning',
    categorySlug: 'data-ai',
    mode: 'hybrid',
    level: 'advanced',
    durationWeeks: 28,
    price: 65000,
    originalPrice: 80000,
    hasCertificate: true,
    rating: 4.8,
    enrollmentSeed: 196,
    shortDescription:
      'A rigorous seven-month path from statistics to deployed machine-learning models.',
    fullDescription:
      'The academy flagship programme. Starts with the statistical foundations most bootcamps skip, then moves through the full modelling lifecycle: feature engineering, model selection, evaluation, interpretability and deployment. Includes a supervised capstone on a real industry dataset, plus dedicated modules on deep learning and MLOps.',
    learningOutcomes: [
      'Apply statistical inference and hypothesis testing correctly',
      'Engineer features that materially improve model performance',
      'Train, tune and evaluate supervised and unsupervised models',
      'Build and train neural networks with PyTorch',
      'Interpret and explain model decisions to non-technical stakeholders',
      'Deploy and monitor models in production',
    ],
    instructor: {
      name: 'Dr. Vikram Shah',
      title: 'Head of Data Science',
      bio: 'PhD in Applied Statistics. Has built forecasting and risk systems for logistics and insurance companies.',
    },
    batches: [
      {
        label: 'Cohort 12 — Hybrid',
        startDate: '2026-09-01',
        endDate: '2027-03-16',
        days: 'Tue, Thu, Sat',
        time: '18:30 - 21:00',
        seatsTotal: 24,
        seatsAvailable: 5,
      },
    ],
  },
  {
    name: 'Data Analytics with Power BI',
    slug: 'data-analytics-power-bi',
    categorySlug: 'data-ai',
    mode: 'online',
    level: 'beginner',
    durationWeeks: 5,
    price: 15000,
    originalPrice: null,
    hasCertificate: true,
    rating: 4.6,
    enrollmentSeed: 341,
    shortDescription:
      'Turn spreadsheets into dashboards that decision-makers actually use.',
    fullDescription:
      'A practical analytics course for people who work with business data but have never built a dashboard. You will connect and clean messy sources with Power Query, model relationships properly, write DAX measures that hold up under scrutiny, and design reports that answer questions at a glance rather than dumping every column on screen.',
    learningOutcomes: [
      'Connect, clean and reshape data with Power Query',
      'Build a sound star-schema data model',
      'Write DAX measures for real business questions',
      'Design dashboards that communicate rather than decorate',
      'Publish and share reports securely with your team',
    ],
    instructor: {
      name: 'Sneha Kulkarni',
      title: 'Business Intelligence Consultant',
      bio: 'Builds reporting systems for retail and healthcare organisations. Certified Microsoft Data Analyst.',
    },
    batches: [
      {
        label: 'Fast-Track Online',
        startDate: '2026-08-05',
        endDate: '2026-09-09',
        days: 'Mon, Wed',
        time: '20:00 - 22:00',
        seatsTotal: 50,
        seatsAvailable: 28,
      },
    ],
  },
  {
    name: 'Cloud Computing with AWS',
    slug: 'cloud-computing-aws',
    categorySlug: 'technology',
    mode: 'online',
    level: 'advanced',
    durationWeeks: 14,
    price: 42000,
    originalPrice: null,
    hasCertificate: true,
    rating: 4.7,
    enrollmentSeed: 158,
    shortDescription:
      'Architect, secure and operate production workloads on AWS.',
    fullDescription:
      'Built around the AWS Solutions Architect curriculum but taught through infrastructure you actually build. Covers core compute, storage and networking, then moves into high availability, cost optimisation, security posture and infrastructure-as-code with Terraform. Prepares you for the Solutions Architect Associate certification.',
    learningOutcomes: [
      'Design highly available, fault-tolerant architectures',
      'Configure VPCs, subnets and security groups correctly',
      'Manage identity and access with least-privilege IAM policies',
      'Provision repeatable infrastructure with Terraform',
      'Optimise workloads for cost and performance',
      'Prepare for the AWS Solutions Architect Associate exam',
    ],
    instructor: {
      name: 'Rahul Nair',
      title: 'Cloud Architect, AWS Certified Professional',
      bio: 'Has migrated more than 40 enterprise workloads to AWS across fintech and media.',
    },
    batches: [
      {
        label: 'Evening Cohort',
        startDate: '2026-08-24',
        endDate: '2026-11-30',
        days: 'Mon, Thu',
        time: '20:00 - 22:30',
        seatsTotal: 35,
        seatsAvailable: 16,
      },
    ],
  },
  {
    name: 'Cybersecurity Essentials',
    slug: 'cybersecurity-essentials',
    categorySlug: 'technology',
    mode: 'hybrid',
    level: 'intermediate',
    durationWeeks: 10,
    price: 38000,
    originalPrice: 44000,
    hasCertificate: true,
    rating: 4.6,
    enrollmentSeed: 143,
    shortDescription:
      'Defend real systems — threat modelling, hardening and incident response.',
    fullDescription:
      'A defensive security course grounded in hands-on lab work. You will threat-model a realistic application, harden Linux and network configurations, run vulnerability assessments against a purpose-built target environment, and work through a simulated incident from detection to post-mortem. All exercises run in an isolated lab.',
    learningOutcomes: [
      'Threat-model an application and prioritise real risks',
      'Harden Linux servers and network configurations',
      'Run and interpret vulnerability assessments',
      'Detect, contain and recover from security incidents',
      'Apply cryptography correctly for data at rest and in transit',
      'Write security policies that teams will actually follow',
    ],
    instructor: {
      name: 'Ahmed Kareem',
      title: 'Security Operations Lead',
      bio: 'Runs a regional SOC team. Background in penetration testing and digital forensics.',
    },
    batches: [
      {
        label: 'Hybrid Lab Batch',
        startDate: '2026-09-14',
        endDate: '2026-11-23',
        days: 'Tue, Sat',
        time: '17:00 - 20:00',
        seatsTotal: 20,
        seatsAvailable: 11,
      },
    ],
  },
  {
    name: 'Mobile App Development with Flutter',
    slug: 'mobile-app-development-flutter',
    categorySlug: 'technology',
    mode: 'online',
    level: 'intermediate',
    durationWeeks: 12,
    price: 32000,
    originalPrice: null,
    hasCertificate: true,
    rating: 4.5,
    enrollmentSeed: 187,
    shortDescription:
      'Ship one codebase to both Android and iOS with Flutter and Dart.',
    fullDescription:
      'Learn Flutter by building four complete applications of increasing complexity, ending with a published app. Covers Dart fundamentals, widget composition, state management with Riverpod, local persistence, REST integration, push notifications, and the full store submission process for both platforms.',
    learningOutcomes: [
      'Write clean, null-safe Dart',
      'Compose responsive UIs from Flutter widgets',
      'Manage application state predictably with Riverpod',
      'Persist data locally and sync with a backend API',
      'Integrate push notifications and deep links',
      'Publish to the Play Store and App Store',
    ],
    instructor: {
      name: 'Kavya Iyer',
      title: 'Mobile Engineering Lead',
      bio: 'Has shipped fifteen production Flutter apps with a combined two million installs.',
    },
    batches: [
      {
        label: 'Weekend Batch',
        startDate: '2026-08-22',
        endDate: '2026-11-14',
        days: 'Sat, Sun',
        time: '15:00 - 17:30',
        seatsTotal: 40,
        seatsAvailable: 25,
      },
    ],
  },
  {
    name: 'Graphic Design with Adobe Suite',
    slug: 'graphic-design-adobe-suite',
    categorySlug: 'design',
    mode: 'offline',
    level: 'beginner',
    durationWeeks: 8,
    price: 22000,
    originalPrice: null,
    hasCertificate: true,
    rating: 4.5,
    enrollmentSeed: 233,
    shortDescription:
      'Master Photoshop, Illustrator and InDesign through studio-style briefs.',
    fullDescription:
      'A studio course run the way an agency runs. Each week brings a real client-style brief — a logo, a poster, a packaging mock-up, a magazine spread — which you present and defend in a group critique. Alongside the tools you will learn the principles that make work hold together: hierarchy, grid, colour and type.',
    learningOutcomes: [
      'Work fluently across Photoshop, Illustrator and InDesign',
      'Apply layout, grid and typographic hierarchy',
      'Build colour palettes with intent',
      'Design print-ready artwork with correct bleed and colour profiles',
      'Present and defend design decisions in critique',
    ],
    instructor: {
      name: 'Meera Pillai',
      title: 'Art Director',
      bio: 'Fifteen years in advertising. Her campaign work has been recognised at regional design awards.',
    },
    batches: [
      {
        label: 'Studio Batch — Campus',
        startDate: '2026-08-11',
        endDate: '2026-10-06',
        days: 'Tue, Thu',
        time: '16:00 - 18:30',
        seatsTotal: 18,
        seatsAvailable: 4,
      },
    ],
  },
  {
    name: 'Video Editing & Motion Graphics',
    slug: 'video-editing-motion-graphics',
    categorySlug: 'design',
    mode: 'offline',
    level: 'beginner',
    durationWeeks: 8,
    price: 19000,
    originalPrice: 24000,
    hasCertificate: true,
    rating: 4.4,
    enrollmentSeed: 167,
    shortDescription:
      'Edit, grade and animate with Premiere Pro and After Effects.',
    fullDescription:
      'From raw footage to a finished, graded, titled piece. The first half covers editing craft in Premiere Pro — pacing, sound design, colour correction. The second half moves into After Effects for motion graphics, kinetic typography and simple visual effects. You will finish with a showreel.',
    learningOutcomes: [
      'Edit for rhythm and narrative, not just continuity',
      'Correct and grade colour to a consistent look',
      'Design and mix a clean audio bed',
      'Animate titles and lower thirds in After Effects',
      'Export correctly for broadcast, web and social platforms',
    ],
    instructor: {
      name: 'Joseph Thomas',
      title: 'Editor & Motion Designer',
      bio: 'Cuts documentary and branded content. Former post-production supervisor.',
    },
    batches: [
      {
        label: 'Evening Lab Batch',
        startDate: '2026-09-07',
        endDate: '2026-11-02',
        days: 'Mon, Wed',
        time: '18:00 - 20:30',
        seatsTotal: 16,
        seatsAvailable: 10,
      },
    ],
  },
  {
    name: 'Canva for Business',
    slug: 'canva-for-business',
    categorySlug: 'design',
    mode: 'online',
    level: 'beginner',
    durationWeeks: 3,
    price: 4500,
    originalPrice: null,
    hasCertificate: false,
    rating: 4.3,
    enrollmentSeed: 402,
    shortDescription:
      'Produce professional marketing collateral without a design team.',
    fullDescription:
      'A short, intensely practical course for small business owners and marketing staff. Three weeks, three outputs: a brand kit, a full social media template set, and a printable collateral pack. Emphasis throughout is on consistency and speed rather than artistry.',
    learningOutcomes: [
      'Set up a reusable brand kit with fonts, colours and logos',
      'Build template sets for every social platform you use',
      'Apply basic layout and hierarchy principles',
      'Produce print-ready flyers, cards and banners',
    ],
    instructor: {
      name: 'Anjali Verma',
      title: 'Brand & Content Designer',
      bio: 'Helps small businesses build coherent visual identities on a budget.',
    },
    batches: [
      {
        label: 'Short Online Sprint',
        startDate: '2026-08-04',
        endDate: '2026-08-25',
        days: 'Tue',
        time: '19:00 - 21:00',
        seatsTotal: 80,
        seatsAvailable: 61,
      },
    ],
  },
  {
    name: 'Digital Marketing & SEO',
    slug: 'digital-marketing-seo',
    categorySlug: 'marketing',
    mode: 'online',
    level: 'beginner',
    durationWeeks: 8,
    price: 18000,
    originalPrice: 22000,
    hasCertificate: true,
    rating: 4.6,
    enrollmentSeed: 389,
    shortDescription:
      'Grow measurable traffic through search, content and paid channels.',
    fullDescription:
      'A full-funnel digital marketing course built around a live website you optimise week by week. Covers technical and on-page SEO, keyword and content strategy, Google Ads, analytics and attribution. Every module ends with a measurable change you make to your own project site.',
    learningOutcomes: [
      'Run technical SEO audits and fix what matters',
      'Build a keyword and content strategy that ranks',
      'Plan and optimise Google Ads campaigns',
      'Configure GA4 and read the reports correctly',
      'Attribute revenue to channels with confidence',
    ],
    instructor: {
      name: 'Nikhil Desai',
      title: 'Growth Marketing Consultant',
      bio: 'Has led SEO and performance marketing for D2C brands across India and the UAE.',
    },
    batches: [
      {
        label: 'Online Evening Batch',
        startDate: '2026-08-18',
        endDate: '2026-10-13',
        days: 'Tue, Thu',
        time: '20:00 - 22:00',
        seatsTotal: 45,
        seatsAvailable: 19,
      },
    ],
  },
  {
    name: 'Social Media Marketing',
    slug: 'social-media-marketing',
    categorySlug: 'marketing',
    mode: 'online',
    level: 'beginner',
    durationWeeks: 4,
    price: 9500,
    originalPrice: null,
    hasCertificate: true,
    rating: 4.4,
    enrollmentSeed: 456,
    shortDescription:
      'Plan, produce and measure content that grows an audience.',
    fullDescription:
      'Four weeks focused entirely on organic and paid social. You will build a content calendar, learn the production shortcuts that make daily posting sustainable, write copy that converts, and run a small paid campaign with a real budget to see the mechanics end to end.',
    learningOutcomes: [
      'Build a sustainable content calendar',
      'Write platform-appropriate copy and hooks',
      'Produce short-form video efficiently',
      'Run and optimise paid social campaigns',
      'Report on the metrics that actually indicate growth',
    ],
    instructor: {
      name: 'Zara Hussain',
      title: 'Social Media Strategist',
      bio: 'Has grown lifestyle and F&B accounts from zero to six figures of engaged following.',
    },
    batches: [
      {
        label: 'Sprint Batch',
        startDate: '2026-08-08',
        endDate: '2026-09-05',
        days: 'Sat',
        time: '10:00 - 13:00',
        seatsTotal: 60,
        seatsAvailable: 37,
      },
    ],
  },
  {
    name: 'Business Accounting & Tally',
    slug: 'business-accounting-tally',
    categorySlug: 'business',
    mode: 'offline',
    level: 'beginner',
    durationWeeks: 12,
    price: 20000,
    originalPrice: null,
    hasCertificate: true,
    rating: 4.5,
    enrollmentSeed: 298,
    shortDescription:
      'Keep books correctly and file with confidence using Tally Prime.',
    fullDescription:
      'A job-oriented accounting course covering both the principles and the software. Starts with double-entry fundamentals and the accounting cycle, then moves into Tally Prime for day-to-day entries, inventory, payroll, GST computation and return filing. Includes practice on realistic company datasets.',
    learningOutcomes: [
      'Apply double-entry principles and close a period correctly',
      'Record the full range of day-to-day transactions in Tally Prime',
      'Manage inventory and payroll modules',
      'Compute GST and prepare returns',
      'Generate and interpret financial statements',
    ],
    instructor: {
      name: 'Suresh Bhat',
      title: 'Chartered Accountant',
      bio: 'Practising CA for eighteen years. Trains accounting staff for SMEs across the region.',
    },
    batches: [
      {
        label: 'Morning Campus Batch',
        startDate: '2026-08-12',
        endDate: '2026-11-04',
        days: 'Mon, Wed, Fri',
        time: '09:00 - 11:00',
        seatsTotal: 28,
        seatsAvailable: 13,
      },
    ],
  },
  {
    name: 'Entrepreneurship Bootcamp',
    slug: 'entrepreneurship-bootcamp',
    categorySlug: 'business',
    mode: 'hybrid',
    level: 'intermediate',
    durationWeeks: 6,
    price: 25000,
    originalPrice: 30000,
    hasCertificate: true,
    rating: 4.7,
    enrollmentSeed: 121,
    shortDescription:
      'Take an idea from assumption to validated, funded business model.',
    fullDescription:
      'An intensive bootcamp for founders with an idea and no roadmap. You will identify and test your riskiest assumptions, talk to real customers, size the market honestly, model unit economics, and build an investor-ready narrative. The programme ends with a pitch to a panel of practising investors and operators.',
    learningOutcomes: [
      'Identify and test the assumptions that could kill your business',
      'Run customer discovery interviews that yield honest signal',
      'Size a market without fooling yourself',
      'Model unit economics and a realistic runway',
      'Build and deliver an investor-ready pitch',
    ],
    instructor: {
      name: 'Deepa Krishnan',
      title: 'Founder & Angel Investor',
      bio: 'Built and exited two SaaS companies. Now invests in and mentors early-stage founders.',
    },
    batches: [
      {
        label: 'Intensive Cohort',
        startDate: '2026-09-21',
        endDate: '2026-11-02',
        days: 'Wed, Sat',
        time: '18:00 - 21:00',
        seatsTotal: 22,
        seatsAvailable: 8,
      },
    ],
  },
  {
    name: 'Spoken English & IELTS Preparation',
    slug: 'spoken-english-ielts',
    categorySlug: 'languages',
    mode: 'offline',
    level: 'beginner',
    durationWeeks: 12,
    price: 14000,
    originalPrice: null,
    hasCertificate: true,
    rating: 4.6,
    enrollmentSeed: 512,
    shortDescription:
      'Build everyday fluency and target the IELTS band score you need.',
    fullDescription:
      'Two goals, one course. The first half develops practical spoken confidence through structured conversation, pronunciation work and vocabulary building. The second half turns to IELTS specifically: task strategies for all four modules, timed practice and individual feedback on writing and speaking with mock tests under exam conditions.',
    learningOutcomes: [
      'Hold extended conversations with confidence',
      'Improve pronunciation, stress and intonation',
      'Apply proven strategies for all four IELTS modules',
      'Write Task 1 and Task 2 responses to band criteria',
      'Manage exam timing under pressure',
    ],
    instructor: {
      name: 'Sarah Mathew',
      title: 'Certified IELTS Trainer (CELTA)',
      bio: 'Has coached over 1,500 candidates, with most reaching their target band on the first attempt.',
    },
    batches: [
      {
        label: 'Morning Batch',
        startDate: '2026-08-05',
        endDate: '2026-10-28',
        days: 'Mon, Wed, Fri',
        time: '08:00 - 10:00',
        seatsTotal: 32,
        seatsAvailable: 15,
      },
      {
        label: 'Evening Batch',
        startDate: '2026-08-05',
        endDate: '2026-10-28',
        days: 'Mon, Wed, Fri',
        time: '18:30 - 20:30',
        seatsTotal: 32,
        seatsAvailable: 6,
      },
    ],
  },
  {
    name: 'Arabic for Beginners',
    slug: 'arabic-for-beginners',
    categorySlug: 'languages',
    mode: 'online',
    level: 'beginner',
    durationWeeks: 8,
    price: 11000,
    originalPrice: null,
    hasCertificate: true,
    rating: 4.7,
    enrollmentSeed: 219,
    shortDescription:
      'Read, write and hold everyday conversations in Modern Standard Arabic.',
    fullDescription:
      'A carefully paced introduction for complete beginners. Weeks one and two cover the script and sound system until reading becomes automatic. From there the course builds practical conversational ability around everyday situations — greetings, directions, shopping, work — with grammar introduced only as each situation requires it.',
    learningOutcomes: [
      'Read and write the Arabic script fluently',
      'Pronounce sounds that do not exist in English',
      'Hold everyday conversations on familiar topics',
      'Understand core grammar: gender, number and verb forms',
      'Build vocabulary through roots and patterns',
    ],
    instructor: {
      name: 'Yusuf Abdullah',
      title: 'Arabic Language Instructor',
      bio: 'Teaches Modern Standard and Gulf dialect Arabic to professionals relocating to the region.',
    },
    batches: [
      {
        label: 'Online Evening Batch',
        startDate: '2026-08-19',
        endDate: '2026-10-14',
        days: 'Sun, Tue',
        time: '19:30 - 21:00',
        seatsTotal: 40,
        seatsAvailable: 24,
      },
    ],
  },
];
