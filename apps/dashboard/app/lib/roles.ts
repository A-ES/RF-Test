/**
 * Comprehensive professional roles catalogue for RF Intelligence.
 * Contains ~65-70 distinct professional roles organized by department / industry category.
 * Used across Onboarding and the Teams section.
 */

export interface RoleCategory {
  name: string;
  roles: string[];
}

export const PROFESSIONAL_ROLE_CATEGORIES: RoleCategory[] = [
  {
    name: "Leadership & Management",
    roles: [
      "CEO",
      "COO",
      "CTO",
      "CFO",
      "Founder / Co-Founder",
      "Managing Director",
      "General Manager",
      "Operations Manager",
      "Project Manager",
      "Program Manager",
    ],
  },
  {
    name: "Engineering & Technology",
    roles: [
      "Software Engineer",
      "Frontend Developer",
      "Backend Developer",
      "Full Stack Developer",
      "DevOps Engineer",
      "Cloud Architect",
      "Data Engineer",
      "Data Analyst",
      "AI / ML Engineer",
      "QA / Test Engineer",
      "IT Systems Administrator",
    ],
  },
  {
    name: "Operations & Supply Chain",
    roles: [
      "Operations Executive",
      "Supply Chain Manager",
      "Logistics Manager",
      "Warehouse Manager",
      "Inventory Controller",
      "Procurement Manager",
      "Production Supervisor",
      "Quality Control Manager",
      "Fleet Manager",
      "Dispatch Coordinator",
    ],
  },
  {
    name: "Sales & Marketing",
    roles: [
      "Sales Manager",
      "Sales Executive",
      "Business Development Manager",
      "Marketing Manager",
      "Digital Marketing Specialist",
      "Content Strategist",
      "Customer Success Manager",
      "Account Manager",
    ],
  },
  {
    name: "Finance & Accounting",
    roles: [
      "Finance Manager",
      "Accountant",
      "Financial Analyst",
      "Accounts Executive",
      "Auditor",
      "Procurement Finance Specialist",
    ],
  },
  {
    name: "Human Resources",
    roles: [
      "HR Manager",
      "HR Executive",
      "Talent Acquisition Specialist",
      "Technical Recruiter",
      "HR Business Partner",
      "Training & Development Manager",
      "Payroll Specialist",
    ],
  },
  {
    name: "Healthcare",
    roles: [
      "Doctor",
      "Nurse Practitioner",
      "Hospital Administrator",
      "Healthcare Operations Manager",
      "Medical Records Officer",
      "Clinical Coordinator",
    ],
  },
  {
    name: "Retail & Food",
    roles: [
      "Store Manager",
      "Retail Operations Executive",
      "Restaurant Manager",
      "Executive Chef",
      "Food Safety & Compliance Officer",
      "Merchandising Manager",
    ],
  },
  {
    name: "Education",
    roles: [
      "Teacher",
      "Lecturer",
      "Professor",
      "Academic Coordinator",
      "Principal / Head of School",
      "Education Administrator",
      "Learning & Development Specialist",
    ],
  },
  {
    name: "Other",
    roles: [
      "Management Consultant",
      "Legal Advisor / Counsel",
      "Customer Support Executive",
      "Business Analyst",
      "Research Analyst",
      "Other",
    ],
  },
];

/**
 * Flat array of all unique role titles
 */
export const ALL_PROFESSIONAL_ROLES = Array.from(
  new Set(PROFESSIONAL_ROLE_CATEGORIES.flatMap((c) => c.roles))
);
