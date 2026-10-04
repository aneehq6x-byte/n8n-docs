import type { Certification, CompanyProfile } from "../domain/models";
import type { RawTender } from "../domain/raw-tender";

/** Stable ids for pure (DB-less) tests and demos. */
export const DEMO_ORG_ID = "0c8f3e2a-1b4d-4c6e-9f10-2a3b4c5d6e7f";
export const DEMO_PROFILE_ID = "11111111-2222-4333-8444-555555555555";

const DAY_MS = 24 * 60 * 60 * 1000;

/** UTC midnight of `reference`, shifted by whole days, at a given UTC hour. */
export function dayOffset(reference: Date, days: number, hourUtc = 0): Date {
  const midnight = Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), reference.getUTCDate());
  return new Date(midnight + days * DAY_MS + hourUtc * 60 * 60 * 1000);
}

interface FixtureSpec extends Omit<RawTender, "source" | "publishedAt" | "submissionDeadline"> {
  publishedDaysAgo: number;
  deadlineInDays: number;
}

/**
 * Realistic Etimad (اعتماد) tenders: real Saudi issuers, sectors, contractor
 * classification fields and SAR values. Dates are expressed relative to a
 * reference date so the demo feed never goes stale.
 */
const SPECS: readonly FixtureSpec[] = [
  {
    sourceRef: "250439001503",
    entity: { nameAr: "وزارة الصحة", nameEn: "Ministry of Health", kind: "ministry", regionAr: "منطقة الرياض", regionEn: "Riyadh Region" },
    titleAr: "إنشاء مركز رعاية صحية أولية في شمال الرياض",
    titleEn: "Construction of a primary healthcare centre in north Riyadh",
    descriptionAr: "تنفيذ أعمال الإنشاء والتجهيز لمركز رعاية صحية أولية بمساحة 3,500 متر مربع شاملاً الأعمال المدنية والكهروميكانيكية.",
    descriptionEn: "Civil and electromechanical works for a 3,500 sqm primary healthcare centre, including fit-out and commissioning.",
    sector: "construction",
    valueEstimate: 18_500_000,
    requiredClassificationField: "buildings",
    requiredClassificationGrade: 3,
    requiredCertifications: ["iso_9001", "saudization_nitaqat", "zakat_compliance"],
    bidBondPct: 0.02,
    performanceBondPct: 0.05,
    publishedDaysAgo: 16,
    deadlineInDays: 24,
    rawDocumentRefs: ["etimad://250439001503/booklet.pdf"],
  },
  {
    sourceRef: "250512774120",
    entity: { nameAr: "هيئة الحكومة الرقمية", nameEn: "Digital Government Authority", kind: "authority", regionAr: "منطقة الرياض", regionEn: "Riyadh Region" },
    titleAr: "تطوير وتشغيل منصة الخدمات الرقمية الموحّدة",
    titleEn: "Development and operation of a unified digital services platform",
    descriptionAr: "تصميم وتطوير وتشغيل منصة خدمات رقمية موحّدة مع التكامل مع منصة النفاذ الوطني الموحّد ومتطلبات أمن المعلومات.",
    descriptionEn: "Design, build and operate a unified digital services platform integrated with the National Single Sign-On and information-security requirements.",
    sector: "information_technology",
    valueEstimate: 7_200_000,
    requiredClassificationField: "it_and_communications",
    requiredClassificationGrade: 2,
    requiredCertifications: ["iso_27001", "citc_license", "saudization_nitaqat"],
    bidBondPct: 0.02,
    performanceBondPct: 0.05,
    publishedDaysAgo: 11,
    deadlineInDays: 5,
    rawDocumentRefs: ["etimad://250512774120/rfp.pdf"],
  },
  {
    sourceRef: "250498233017",
    entity: { nameAr: "أمانة منطقة الرياض", nameEn: "Riyadh Municipality", kind: "municipality", regionAr: "منطقة الرياض", regionEn: "Riyadh Region" },
    titleAr: "صيانة الطرق الداخلية وتصريف مياه الأمطار شمال الرياض",
    titleEn: "Maintenance of internal roads and rainwater drainage, north Riyadh",
    descriptionAr: "أعمال صيانة وإعادة تأهيل للطرق الداخلية وشبكات تصريف مياه الأمطار على مدى 24 شهرًا.",
    descriptionEn: "Rehabilitation and 24-month maintenance of internal roads and rainwater drainage networks.",
    sector: "transport",
    valueEstimate: 42_000_000,
    requiredClassificationField: "roads",
    requiredClassificationGrade: 2,
    requiredCertifications: ["iso_9001", "ohsas_45001", "saudization_nitaqat"],
    bidBondPct: 0.01,
    performanceBondPct: 0.05,
    publishedDaysAgo: 21,
    deadlineInDays: 34,
    rawDocumentRefs: ["etimad://250498233017/scope.pdf"],
  },
  {
    sourceRef: "250467119884",
    entity: { nameAr: "وزارة التعليم", nameEn: "Ministry of Education", kind: "ministry", regionAr: "منطقة مكة المكرمة", regionEn: "Makkah Region" },
    titleAr: "توريد وتركيب تجهيزات مختبرات مدرسية في مكة المكرمة",
    titleEn: "Supply and installation of school laboratory equipment in Makkah",
    descriptionAr: "توريد وتركيب أجهزة ومعدات مختبرات العلوم لعدد 40 مدرسة مع التدريب والضمان لمدة سنتين.",
    descriptionEn: "Supply and install science-lab equipment for 40 schools, including training and a two-year warranty.",
    sector: "education",
    valueEstimate: 9_800_000,
    requiredClassificationField: null,
    requiredClassificationGrade: null,
    requiredCertifications: ["iso_9001", "zakat_compliance"],
    bidBondPct: 0.02,
    performanceBondPct: 0.05,
    publishedDaysAgo: 14,
    deadlineInDays: 19,
    rawDocumentRefs: ["etimad://250467119884/boq.pdf"],
  },
  {
    sourceRef: "250523660471",
    entity: { nameAr: "تجمع الرياض الصحي الأول", nameEn: "Riyadh First Health Cluster", kind: "authority", regionAr: "منطقة الرياض", regionEn: "Riyadh Region" },
    titleAr: "تشغيل وصيانة الأجهزة الطبية في مستشفى الملك سعود",
    titleEn: "Operation and maintenance of medical equipment at King Saud Hospital",
    descriptionAr: "عقد تشغيل وصيانة شاملة للأجهزة الطبية الحيوية مع قطع الغيار والدعم الفني على مدار الساعة لمدة 36 شهرًا.",
    descriptionEn: "Full operation and maintenance of biomedical equipment with spares and 24/7 technical support for 36 months.",
    sector: "healthcare",
    valueEstimate: 25_000_000,
    requiredClassificationField: "operation_and_maintenance",
    requiredClassificationGrade: 3,
    requiredCertifications: ["sfda_license", "iso_9001", "ohsas_45001", "saudization_nitaqat"],
    bidBondPct: 0.02,
    performanceBondPct: 0.05,
    publishedDaysAgo: 8,
    deadlineInDays: 40,
    rawDocumentRefs: ["etimad://250523660471/contract.pdf"],
  },
  {
    sourceRef: "250551002388",
    entity: { nameAr: "وزارة النقل والخدمات اللوجستية", nameEn: "Ministry of Transport and Logistic Services", kind: "ministry", regionAr: "المنطقة الشرقية", regionEn: "Eastern Province" },
    titleAr: "إنشاء تقاطع طرق إقليمي على الطريق السريع",
    titleEn: "Construction of a regional highway interchange",
    descriptionAr: "تنفيذ أعمال إنشاء تقاطع طرق إقليمي متعدد المستويات يشمل الجسور والأنفاق والأعمال الترابية الكبرى.",
    descriptionEn: "Construction of a multi-level regional highway interchange including bridges, tunnels and major earthworks.",
    sector: "transport",
    valueEstimate: 320_000_000,
    requiredClassificationField: "roads",
    requiredClassificationGrade: 1,
    requiredCertifications: ["iso_9001", "ohsas_45001", "iso_14001", "saudization_nitaqat"],
    bidBondPct: 0.01,
    performanceBondPct: 0.05,
    publishedDaysAgo: 6,
    deadlineInDays: 55,
    rawDocumentRefs: ["etimad://250551002388/tender-docs.pdf"],
  },
  {
    sourceRef: "250588412265",
    entity: { nameAr: "الهيئة السعودية للمياه", nameEn: "Saudi Water Authority", kind: "authority", regionAr: "منطقة القصيم", regionEn: "Qassim Region" },
    titleAr: "صيانة خطوط نقل المياه في منطقة القصيم",
    titleEn: "Maintenance of water transmission pipelines in Qassim",
    descriptionAr: "صيانة وقائية وتصحيحية لخطوط نقل المياه ومحطات الضخ بطول 180 كيلومترًا لمدة ثلاث سنوات.",
    descriptionEn: "Preventive and corrective maintenance of 180 km of water transmission lines and pumping stations over three years.",
    sector: "water",
    valueEstimate: 36_000_000,
    requiredClassificationField: "water_and_sewage",
    requiredClassificationGrade: 3,
    requiredCertifications: ["iso_9001", "ohsas_45001"],
    bidBondPct: 0.02,
    performanceBondPct: 0.05,
    publishedDaysAgo: 3,
    deadlineInDays: 28,
    rawDocumentRefs: ["etimad://250588412265/specs.pdf"],
  },
  {
    sourceRef: "250601237719",
    entity: { nameAr: "جامعة الملك سعود", nameEn: "King Saud University", kind: "university", regionAr: "منطقة الرياض", regionEn: "Riyadh Region" },
    titleAr: "تشغيل وصيانة المرافق والمباني الجامعية",
    titleEn: "Operation and maintenance of university campus facilities",
    descriptionAr: "تشغيل وصيانة شاملة لأنظمة التكييف والكهرباء والسباكة في 60 مبنى جامعيًا مع فرق عمل مقيمة.",
    descriptionEn: "Comprehensive O&M of HVAC, electrical and plumbing systems across 60 campus buildings with resident crews.",
    sector: "facilities_management",
    valueEstimate: 54_000_000,
    requiredClassificationField: "operation_and_maintenance",
    requiredClassificationGrade: 3,
    requiredCertifications: ["iso_9001", "ohsas_45001", "saudization_nitaqat", "gosi_compliance"],
    bidBondPct: 0.02,
    performanceBondPct: 0.05,
    publishedDaysAgo: 9,
    deadlineInDays: 3,
    rawDocumentRefs: ["etimad://250601237719/rfp.pdf"],
  },
  {
    sourceRef: "250612904431",
    entity: { nameAr: "وزارة البلديات والإسكان", nameEn: "Ministry of Municipalities and Housing", kind: "ministry", regionAr: "منطقة الرياض", regionEn: "Riyadh Region" },
    titleAr: "إنشاء حدائق ومرافق عامة في حي النرجس بالرياض",
    titleEn: "Construction of public parks and amenities in Al-Narjis, Riyadh",
    descriptionAr: "تنفيذ حدائق عامة وممرات مشاة وملاعب ومرافق خدمية على مساحة 45,000 متر مربع.",
    descriptionEn: "Delivery of public parks, walkways, playgrounds and service amenities across 45,000 sqm.",
    sector: "construction",
    valueEstimate: 12_400_000,
    requiredClassificationField: "buildings",
    requiredClassificationGrade: 4,
    requiredCertifications: ["iso_9001", "local_content_baladi", "saudization_nitaqat"],
    bidBondPct: 0.02,
    performanceBondPct: 0.05,
    publishedDaysAgo: 2,
    deadlineInDays: 6,
    rawDocumentRefs: ["etimad://250612904431/drawings.pdf"],
  },
  {
    sourceRef: "250623558190",
    entity: { nameAr: "هيئة تطوير منطقة المدينة المنورة", nameEn: "Madinah Region Development Authority", kind: "authority", regionAr: "منطقة المدينة المنورة", regionEn: "Madinah Region" },
    titleAr: "تأهيل واجهات المباني التاريخية في المدينة المنورة",
    titleEn: "Rehabilitation of historic building facades in Madinah",
    descriptionAr: "ترميم وتأهيل واجهات 120 مبنى تاريخيًا وفق الهوية العمرانية لمنطقة المدينة المنورة.",
    descriptionEn: "Restoration of 120 historic building facades in line with Madinah's urban design identity.",
    sector: "construction",
    valueEstimate: 21_000_000,
    requiredClassificationField: "buildings",
    requiredClassificationGrade: 3,
    requiredCertifications: ["iso_9001", "iso_14001", "saudization_nitaqat"],
    bidBondPct: 0.02,
    performanceBondPct: 0.05,
    publishedDaysAgo: 4,
    deadlineInDays: 31,
    rawDocumentRefs: ["etimad://250623558190/heritage-guidelines.pdf"],
  },
  {
    sourceRef: "250634771052",
    entity: { nameAr: "وزارة الطاقة", nameEn: "Ministry of Energy", kind: "ministry", regionAr: "منطقة الرياض", regionEn: "Riyadh Region" },
    titleAr: "تركيب أنظمة طاقة شمسية لمبانٍ حكومية",
    titleEn: "Installation of solar PV systems for government buildings",
    descriptionAr: "توريد وتركيب وتشغيل أنظمة طاقة شمسية بقدرة إجمالية 6 ميجاواط على أسطح 35 مبنى حكوميًا.",
    descriptionEn: "Supply, install and commission 6 MW of rooftop solar PV across 35 government buildings.",
    sector: "energy",
    valueEstimate: 15_000_000,
    requiredClassificationField: "electrical_works",
    requiredClassificationGrade: 3,
    requiredCertifications: ["iso_9001", "iso_14001", "local_content_baladi"],
    bidBondPct: 0.02,
    performanceBondPct: 0.05,
    publishedDaysAgo: 5,
    deadlineInDays: 22,
    rawDocumentRefs: ["etimad://250634771052/technical-specs.pdf"],
  },
  {
    sourceRef: "250645119963",
    entity: { nameAr: "الهيئة العامة للطيران المدني", nameEn: "General Authority of Civil Aviation", kind: "authority", regionAr: "منطقة القصيم", regionEn: "Qassim Region" },
    titleAr: "صيانة مدارج وساحات مطار الأمير نايف بن عبدالعزيز بالقصيم",
    titleEn: "Runway and apron maintenance at Prince Naif bin Abdulaziz Airport, Qassim",
    descriptionAr: "إعادة سفلتة المدرج الرئيسي وصيانة الساحات والإنارة الأرضية دون تعطيل الحركة الجوية.",
    descriptionEn: "Main runway resurfacing plus apron and airfield-lighting maintenance without disrupting air traffic.",
    sector: "transport",
    valueEstimate: 48_000_000,
    requiredClassificationField: "roads",
    requiredClassificationGrade: 2,
    requiredCertifications: ["iso_9001", "ohsas_45001", "saudization_nitaqat"],
    bidBondPct: 0.01,
    performanceBondPct: 0.05,
    publishedDaysAgo: 1,
    deadlineInDays: 2,
    rawDocumentRefs: ["etimad://250645119963/airfield-scope.pdf"],
  },
];

/** Build the Etimad fixture feed relative to `reference` (published 08:00 UTC, deadlines 11:00 UTC). */
export function etimadFixtures(reference: Date): RawTender[] {
  return SPECS.map(({ publishedDaysAgo, deadlineInDays, ...rest }) => ({
    ...rest,
    source: "etimad",
    publishedAt: dayOffset(reference, -publishedDaysAgo, 8).toISOString(),
    submissionDeadline: dayOffset(reference, deadlineInDays, 11).toISOString(),
  }));
}

/** The demo bidder — a mid-size Saudi contractor. */
export function demoCompanyProfile(ids: { orgId: string; id: string } = { orgId: DEMO_ORG_ID, id: DEMO_PROFILE_ID }): CompanyProfile {
  return {
    id: ids.id,
    orgId: ids.orgId,
    legalName: { ar: "شركة البنيان المتقدمة للمقاولات", en: "Al-Bunyan Advanced Contracting Co." },
    sectors: ["construction", "transport", "facilities_management", "healthcare"],
    classifications: [
      { field: "buildings", grade: 3 },
      { field: "roads", grade: 2 },
      { field: "operation_and_maintenance", grade: 3 },
      { field: "water_and_sewage", grade: 4 },
    ],
    annualTurnover: 120_000_000,
    maxContractValue: 60_000_000,
    pastProjects: [
      {
        title: { ar: "إنشاء مجمع مدارس في الخرج", en: "School complex in Al-Kharj" },
        sector: "construction",
        value: 22_000_000,
        performanceRating: 0.92,
        year: 2024,
      },
      {
        title: { ar: "صيانة طرق في محافظة الدرعية", en: "Road maintenance in Diriyah" },
        sector: "transport",
        value: 31_000_000,
        performanceRating: 0.84,
        year: 2023,
      },
      {
        title: { ar: "تشغيل وصيانة مرافق مستشفى", en: "Hospital facilities O&M" },
        sector: "healthcare",
        value: 14_000_000,
        performanceRating: 0.7,
        year: 2025,
      },
    ],
  };
}

const CERT_SPECS = [
  { n: 1, type: "iso_9001", issuer: "Bureau Veritas", issuedDaysAgo: 511, expiresInDays: 220 },
  { n: 2, type: "ohsas_45001", issuer: "SGS", issuedDaysAgo: 421, expiresInDays: 309 },
  { n: 3, type: "iso_14001", issuer: "SGS", issuedDaysAgo: 421, expiresInDays: 309 },
  { n: 4, type: "saudization_nitaqat", issuer: "Ministry of Human Resources", issuedDaysAgo: 176, expiresInDays: 188 },
  { n: 5, type: "zakat_compliance", issuer: "ZATCA", issuedDaysAgo: 162, expiresInDays: 203 },
] as const;

/** Certifications held by the demo company, valid relative to `reference`. */
export function demoCertifications(
  reference: Date,
  ids: { orgId: string; companyProfileId: string } = { orgId: DEMO_ORG_ID, companyProfileId: DEMO_PROFILE_ID },
): Certification[] {
  return CERT_SPECS.map((c) => ({
    id: `aaaaaaa1-0000-4000-8000-00000000000${c.n}`,
    orgId: ids.orgId,
    companyProfileId: ids.companyProfileId,
    type: c.type,
    issuer: c.issuer,
    issuedAt: dayOffset(reference, -c.issuedDaysAgo),
    expiresAt: dayOffset(reference, c.expiresInDays),
  }));
}
