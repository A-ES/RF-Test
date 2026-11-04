"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Activity,
  ArrowRight,
  ArrowLeft,
  Loader2,
  AlertOctagon,
  Eye,
  BellRing,
  Target,
  Check,
} from "lucide-react";

interface IndustryContext {
  activities: string[];
  challenges: string[];
  monitoring: string[];
  alerts: string[];
}

const INDUSTRY_PROFILES: Record<string, IndustryContext> = {
  Manufacturing: {
    activities: [
      "Bulk raw material intake",
      "Production line dispatch",
      "Finished goods batching",
      "B2B contractor shipments",
    ],
    challenges: [
      "Machine downtime & bottlenecks",
      "Raw material shortages & stockouts",
      "Production schedule slippage",
      "Supplier lead-time volatility",
    ],
    monitoring: [
      "Batch cycle delays & line pace",
      "Raw inventory depletion rate",
      "Subcontractor fulfillment SLAs",
      "Quality inspection pass rates",
    ],
    alerts: [
      "Critical stockout risk (< 48 hrs)",
      "Unplanned production stoppage",
      "Supplier PO delivery delay",
      "Quality variance alert",
    ],
  },
  Retail: {
    activities: [
      "Multi-store inventory allocation",
      "High-velocity order fulfillment",
      "Returns and replenishment",
      "Vendor margin tracking",
    ],
    challenges: [
      "Stockouts on top-selling SKUs",
      "Supplier delivery unpredictability",
      "Excess dead inventory in backrooms",
      "Inaccurate inventory counts",
    ],
    monitoring: [
      "Real-time sell-through velocity",
      "Depot-to-retail stock transfers",
      "Vendor fulfillment accuracy",
      "SKU stockout probability",
    ],
    alerts: [
      "Low inventory warning on top SKUs",
      "Supplier shipment delay",
      "Discrepant inventory intake",
      "Demand spike detected",
    ],
  },
  "Food & Beverage": {
    activities: [
      "Cold-chain distribution",
      "Perishable stock rotation (FIFO)",
      "Bulk distributor supply",
      "Institutional food services",
    ],
    challenges: [
      "Raw material spoilage & shelf-life",
      "Demand swings across seasons",
      "Cold-chain temperature logs",
      "Expedited shipping costs",
    ],
    monitoring: [
      "Batch expiration tracking",
      "Chilled transport lead times",
      "Supplier freshness certifications",
      "Warehouse turn velocity",
    ],
    alerts: [
      "Impending product expiry (< 7 days)",
      "Spoilage threshold alert",
      "Cold-chain route delay",
      "Bulk order cancellation",
    ],
  },
  "Logistics and Supply Chain": {
    activities: [
      "Fleet dispatch & route balancing",
      "Cross-docking & transshipment",
      "Carrier rate negotiation",
      "Freight tracking & customer dispatch",
    ],
    challenges: [
      "In-transit transit delays",
      "Carrier capacity crunches",
      "Cross-dock handling bottlenecks",
      "Proof of Delivery (POD) lag",
    ],
    monitoring: [
      "On-time in-full (OTIF) metrics",
      "Carrier exception frequency",
      "Cross-dock dwell time",
      "Fuel & route efficiency",
    ],
    alerts: [
      "Critical route breakdown / delay",
      "Carrier SLA violation alert",
      "Unassigned shipment backlog",
      "Delivery exception flag",
    ],
  },
  default: {
    activities: [
      "Wholesale distribution",
      "Inventory procurement",
      "Multi-channel client sales",
      "Warehouse fulfillment",
    ],
    challenges: [
      "Supplier delivery delays",
      "Inventory holding costs",
      "Communication silos with buyers",
      "Manual order re-entry errors",
    ],
    monitoring: [
      "Stock movement velocity",
      "Open purchase orders",
      "Customer conversational inquiries",
      "Order fulfillment cycle time",
    ],
    alerts: [
      "Critical inventory depletion",
      "Supplier lead-time extension",
      "High-priority client inquiry",
      "Order fulfillment blockage",
    ],
  },
};

export default function BusinessProfilePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [businessType, setBusinessType] = useState<string>("Manufacturing");
  const [activities, setActivities] = useState<string[]>([]);
  const [challenges, setChallenges] = useState<string[]>([]);
  const [monitoringAreas, setMonitoringAreas] = useState<string[]>([]);
  const [alertPreferences, setAlertPreferences] = useState<string[]>([]);
  const [priorityNote, setPriorityNote] = useState("");

  useEffect(() => {
    async function loadData() {
      try {
        const res = await fetch("/api/onboarding/status");
        if (res.ok) {
          const data = await res.json();
          const type = data.status?.businessType || "Manufacturing";
          setBusinessType(type);

          const profile = INDUSTRY_PROFILES[type] || INDUSTRY_PROFILES.default;
          // Pre-select top options to make questionnaire quick and low friction
          setActivities([profile.activities[0], profile.activities[1]]);
          setChallenges([profile.challenges[0], profile.challenges[1]]);
          setMonitoringAreas([profile.monitoring[0], profile.monitoring[1]]);
          setAlertPreferences([profile.alerts[0], profile.alerts[1]]);
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadData();
  }, []);

  const activeProfile = INDUSTRY_PROFILES[businessType] || INDUSTRY_PROFILES.default;

  function toggleItem(list: string[], setList: (v: string[]) => void, item: string) {
    if (list.includes(item)) {
      setList(list.filter((x) => x !== item));
    } else {
      setList([...list, item]);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/onboarding/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationalActivities: activities,
          challenges,
          monitoringAreas,
          alertPreferences,
          priorities: priorityNote ? [priorityNote] : [],
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save operational profile.");
        return;
      }

      router.push("/onboarding/team");
    } catch {
      setError("Network error while connecting to server.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-center">
        <div className="size-8 rounded-full border-2 border-[#F24E4B] border-t-transparent animate-spin mb-4" />
        <p className="text-sm text-white/60 font-mono">Customizing questions for {businessType}...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300 max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F24E4B]/10 border border-[#F24E4B]/30 text-[#F24E4B] text-xs font-mono font-medium">
          <Activity className="size-3.5" />
          <span>STEP 4 OF 6 &bull; BUSINESS OPERATIONS</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Understand your operational focus
        </h1>
        <p className="text-xs sm:text-sm text-white/60 max-w-lg mx-auto">
          Tailored for <span className="text-white font-medium">{businessType}</span>. Your selections will prioritize telemetry, alert sensitivity, and dashboard insights.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[#F24E4B]/40 bg-[#F24E4B]/10 p-3 text-xs text-[#F24E4B]">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Operational Activities */}
        <div className="rounded-2xl border border-white/10 bg-[#0D0E12] p-6 shadow-xl space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Target className="size-4 text-[#F24E4B]" />
            <span>Primary Operational Activities</span>
          </div>
          <p className="text-xs text-white/50">
            What workflows does your business execute daily? (Select all that apply)
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            {activeProfile.activities.map((act) => {
              const active = activities.includes(act);
              return (
                <button
                  key={act}
                  type="button"
                  onClick={() => toggleItem(activities, setActivities, act)}
                  className={`flex items-center justify-between p-3 rounded-xl border text-xs text-left transition-all ${
                    active
                      ? "border-[#F24E4B] bg-[#F24E4B]/10 text-white font-medium"
                      : "border-white/10 bg-white/[0.02] text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span>{act}</span>
                  <div
                    className={`size-4 rounded flex items-center justify-center border ${
                      active ? "border-[#F24E4B] bg-[#F24E4B] text-black" : "border-white/20"
                    }`}
                  >
                    {active && <Check className="size-3 stroke-[3]" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 2: Biggest Operational Challenges */}
        <div className="rounded-2xl border border-white/10 bg-[#0D0E12] p-6 shadow-xl space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <AlertOctagon className="size-4 text-amber-400" />
            <span>Biggest Operational Challenges</span>
          </div>
          <p className="text-xs text-white/50">
            Where do friction, stock losses, or unbudgeted delays occur most often?
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            {activeProfile.challenges.map((ch) => {
              const active = challenges.includes(ch);
              return (
                <button
                  key={ch}
                  type="button"
                  onClick={() => toggleItem(challenges, setChallenges, ch)}
                  className={`flex items-center justify-between p-3 rounded-xl border text-xs text-left transition-all ${
                    active
                      ? "border-amber-500/50 bg-amber-500/10 text-white font-medium"
                      : "border-white/10 bg-white/[0.02] text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span>{ch}</span>
                  <div
                    className={`size-4 rounded flex items-center justify-center border ${
                      active ? "border-amber-400 bg-amber-400 text-black" : "border-white/20"
                    }`}
                  >
                    {active && <Check className="size-3 stroke-[3]" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 3: Monitoring & Alert Preferences */}
        <div className="rounded-2xl border border-white/10 bg-[#0D0E12] p-6 shadow-xl space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Eye className="size-4 text-sky-400" />
            <span>What Should RF Intelligence Monitor Closely?</span>
          </div>
          <p className="text-xs text-white/50">
            Choose the metrics to surface prominently on your executive bento grid:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            {activeProfile.monitoring.map((m) => {
              const active = monitoringAreas.includes(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleItem(monitoringAreas, setMonitoringAreas, m)}
                  className={`flex items-center justify-between p-3 rounded-xl border text-xs text-left transition-all ${
                    active
                      ? "border-sky-500/50 bg-sky-500/10 text-white font-medium"
                      : "border-white/10 bg-white/[0.02] text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span>{m}</span>
                  <div
                    className={`size-4 rounded flex items-center justify-center border ${
                      active ? "border-sky-400 bg-sky-400 text-black" : "border-white/20"
                    }`}
                  >
                    {active && <Check className="size-3 stroke-[3]" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 4: Alert Notifications */}
        <div className="rounded-2xl border border-white/10 bg-[#0D0E12] p-6 shadow-xl space-y-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <BellRing className="size-4 text-[#F24E4B]" />
            <span>High-Priority Alert Triggers</span>
          </div>
          <p className="text-xs text-white/50">
            Select the events that require instant push notifications and escalation:
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            {activeProfile.alerts.map((al) => {
              const active = alertPreferences.includes(al);
              return (
                <button
                  key={al}
                  type="button"
                  onClick={() => toggleItem(alertPreferences, setAlertPreferences, al)}
                  className={`flex items-center justify-between p-3 rounded-xl border text-xs text-left transition-all ${
                    active
                      ? "border-[#F24E4B] bg-[#F24E4B]/10 text-white font-medium"
                      : "border-white/10 bg-white/[0.02] text-white/70 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span>{al}</span>
                  <div
                    className={`size-4 rounded flex items-center justify-center border ${
                      active ? "border-[#F24E4B] bg-[#F24E4B] text-black" : "border-white/20"
                    }`}
                  >
                    {active && <Check className="size-3 stroke-[3]" />}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Section 5: Current Quarter Priorities (Optional) */}
        <div className="rounded-2xl border border-white/10 bg-[#0D0E12] p-6 shadow-xl space-y-2">
          <label className="block text-xs font-semibold text-white">
            Current Quarter Key Strategic Priority <span className="text-white/40 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={priorityNote}
            onChange={(e) => setPriorityNote(e.target.value)}
            placeholder="e.g. Cut supplier fulfillment lag by 20% and reduce warehouse deadstock"
            className="w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B]"
          />
        </div>

        {/* Action button */}
        <div className="pt-2 flex items-center justify-between">
          <button
            type="button"
            onClick={() => router.push("/onboarding/identity")}
            className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
          >
            <ArrowLeft className="size-3.5" />
            <span>Back</span>
          </button>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#F24E4B] hover:bg-[#d63f3c] text-white py-2.5 px-6 text-xs sm:text-sm font-semibold tracking-wide shadow-lg shadow-[#F24E4B]/20 disabled:opacity-50 transition-all cursor-pointer"
          >
            {saving ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                <span>Configuring Telemetry...</span>
              </>
            ) : (
              <>
                <span>Continue to Team Setup</span>
                <ArrowRight className="size-4" />
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
