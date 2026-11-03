"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  TeamLanyardRail,
  LanyardMember,
} from "@/app/components/onboarding/team-lanyard-rail";
import { ArrowRight, ArrowLeft, Sparkles, ShieldCheck } from "lucide-react";

function getInitialsAvatar(name: string, tone = 1): string {
  const initials =
    name
      .split(/\s+/)
      .map((p) => p[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "RF";
  const bgColors = ["#1E222A", "#261E20", "#18242A", "#25211B", "#221E28"];
  const fgColors = ["#F24E4B", "#60A5FA", "#34D399", "#FBBF24", "#A78BFA"];
  const bg = bgColors[(tone - 1) % bgColors.length];
  const fg = fgColors[(tone - 1) % fgColors.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="${bg}"/><circle cx="64" cy="64" r="56" fill="none" stroke="${fg}" stroke-width="2" opacity="0.3"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" fill="${fg}" font-family="system-ui, -apple-system, sans-serif" font-size="44" font-weight="700" letter-spacing="1">${initials}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export default function TeamPresentationPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [orgName, setOrgName] = useState("RF Intelligence Workspace");
  const [items, setItems] = useState<LanyardMember[]>([]);

  useEffect(() => {
    async function loadTeamData() {
      try {
        const res = await fetch("/api/onboarding/status");
        if (!res.ok) throw new Error("Failed to load team presentation");
        const data = await res.json();

        const organizationName =
          data.status?.companyName ||
          data.session?.organization?.name ||
          "RF Intelligence";
        setOrgName(organizationName);

        const owner = data.owner || data.session;
        const membersList: any[] = data.status?.invitedMembers || [];

        // Build LanyardMember array starting with Organization Owner
        const ownerJob = owner?.jobTitle?.trim() || "Organization Administrator";
        const lanyardMembers: LanyardMember[] = [
          {
            id: owner?.id || "owner_badge",
            name: owner?.name || "Workspace Owner",
            role: ownerJob,
            team: organizationName,
            image: getInitialsAvatar(owner?.name || "Owner", 1),
            bio: `${owner?.name || "Workspace Owner"} · ${ownerJob} · Organization Administrator`,
            tags: ["Workspace Admin", "Owner"],
            links: [
              { label: "Email", href: `mailto:${owner?.email || "owner@rf.local"}` },
            ],
            tone: 1, // Red ribbon
            drop: 8,
          },
        ];

        // Tone cycling for ribbons: 1 to 5
        const TONE_CYCLE: (1 | 2 | 3 | 4 | 5)[] = [2, 3, 4, 5, 1];

        membersList.forEach((m, idx) => {
          const tone = TONE_CYCLE[idx % TONE_CYCLE.length] ?? 2;
          const memberJob = m.role?.trim() || m.jobTitle?.trim() || "Team Member";
          lanyardMembers.push({
            id: `member_${idx}_${m.email}`,
            name: m.name,
            role: memberJob,
            team: organizationName,
            image: getInitialsAvatar(m.name, tone),
            bio: `${m.name} · ${memberJob} · Team Member`,
            tags: [memberJob, "Active"],
            links: [
              { label: "Email", href: `mailto:${m.email}` },
            ],
            tone,
            drop: (idx * 5) % 24,
          });
        });

        setItems(lanyardMembers);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    loadTeamData();
  }, []);

  function handleComplete() {
    router.push("/onboarding/launch");
  }

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center text-center">
        <div className="size-8 rounded-full border-2 border-[#F24E4B] border-t-transparent animate-spin mb-4" />
        <p className="text-sm text-white/60 font-mono">
          Generating team lanyard badges...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F24E4B]/10 border border-[#F24E4B]/30 text-[#F24E4B] text-xs font-mono font-medium">
          <Sparkles className="size-3.5" />
          <span>STEP 6 OF 6 &bull; TEAM PRESENTATION</span>
        </div>
        <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
          Meet your {orgName} team
        </h1>
        <p className="text-xs sm:text-sm text-white/60 max-w-lg mx-auto">
          Interactive security credentials prepared for your organization. Flip or tug any badge to inspect contact channels, role details, and digital credentials.
        </p>
      </div>

      {/* Lanyard Showcase Stage */}
      <div className="rounded-3xl border border-white/10 bg-[#0A0B0E] shadow-2xl p-2 sm:p-6 relative overflow-hidden">
        {/* Exact TeamLanyardRail component invocation */}
        <TeamLanyardRail
          items={items}
          eyebrow="CREDENTIAL DIRECTORY"
          heading={`${orgName} Operational Roster`}
          caption="Click or tap any badge to flip between credentials and role telemetry."
          autoplay={true}
          interval={3000}
          action={
            <div className="pt-3 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => router.push("/onboarding/team")}
                className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white px-4 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
              >
                <ArrowLeft className="size-3.5" />
                <span>Back to Team</span>
              </button>

              <button
                type="button"
                onClick={handleComplete}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#F24E4B] hover:bg-[#d63f3c] text-white py-3 px-8 text-sm font-semibold tracking-wide shadow-xl shadow-[#F24E4B]/25 hover:scale-[1.02] active:scale-[0.98] transition-all cursor-pointer"
              >
                <span>Launch Your Workspace</span>
                <ArrowRight className="size-4" />
              </button>
            </div>
          }
        />
      </div>

      {/* Footer Info Pill */}
      <div className="flex items-center justify-center gap-2 text-xs text-white/40 font-mono">
        <ShieldCheck className="size-3.5 text-emerald-400" />
        <span>Badges rendered dynamically from verified tenant memberships</span>
      </div>
    </div>
  );
}
