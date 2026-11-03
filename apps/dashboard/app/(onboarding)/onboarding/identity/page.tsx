"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Building2, ArrowRight, ArrowLeft, Loader2, Globe, MapPin, Users2, FileText, Check } from "lucide-react";

const BUSINESS_TYPES = [
  "Manufacturing",
  "Retail",
  "Food & Beverage",
  "Logistics and Supply Chain",
  "Technology / SaaS",
  "Healthcare",
  "Construction",
  "Other",
];

const COMPANY_SIZES = [
  "1–10 employees",
  "11–50 employees",
  "51–200 employees",
  "201–500 employees",
  "500+ enterprise",
];

export default function IdentityPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form states
  const [companyName, setCompanyName] = useState("");
  const [businessType, setBusinessType] = useState("Manufacturing");
  const [customBusinessType, setCustomBusinessType] = useState("");
  const [website, setWebsite] = useState("");
  const [companySize, setCompanySize] = useState("11–50 employees");
  const [location, setLocation] = useState("United States");
  const [description, setDescription] = useState("");

  useEffect(() => {
    async function loadIdentity() {
      try {
        const res = await fetch("/api/onboarding/status");
        if (res.ok) {
          const data = await res.json();
          if (data.status?.companyName) {
            setCompanyName(data.status.companyName);
          } else if (data.session?.organizationId) {
            setCompanyName("Pacific Coast Supply Co.");
          }
          if (data.status?.businessType) {
            if (BUSINESS_TYPES.includes(data.status.businessType)) {
              setBusinessType(data.status.businessType);
            } else {
              setBusinessType("Other");
              setCustomBusinessType(data.status.businessType);
            }
          }
        }
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    loadIdentity();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaving(true);

    try {
      const res = await fetch("/api/onboarding/identity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyName,
          businessType,
          customBusinessType: businessType === "Other" ? customBusinessType : undefined,
          website,
          companySize,
          location,
          description,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save organization identity.");
        return;
      }

      router.push("/onboarding/business");
    } catch {
      setError("Network error while saving identity.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-center">
        <div className="size-8 rounded-full border-2 border-[#F24E4B] border-t-transparent animate-spin mb-4" />
        <p className="text-sm text-white/60 font-mono">Loading organization settings...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300 max-w-3xl mx-auto">
      {/* Header */}
      <div className="text-center space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F24E4B]/10 border border-[#F24E4B]/30 text-[#F24E4B] text-xs font-mono font-medium">
          <Building2 className="size-3.5" />
          <span>STEP 3 OF 6 &bull; ORGANIZATION IDENTITY</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Tell us about your organization
        </h1>
        <p className="text-xs sm:text-sm text-white/60 max-w-lg mx-auto">
          We use this identity profile to localize your wholesale environment, alerts, and tenant data isolation.
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-[#F24E4B]/40 bg-[#F24E4B]/10 p-3 text-xs text-[#F24E4B]">
          {error}
        </div>
      )}

      {/* Form Card */}
      <div className="rounded-2xl border border-white/10 bg-[#0D0E12] p-6 sm:p-8 shadow-xl">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Company Name */}
          <div>
            <label className="block text-xs font-semibold text-white/90 mb-1.5">
              Organization / Company Name <span className="text-[#F24E4B]">*</span>
            </label>
            <input
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Apex Wholesale Supply LLC"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B] transition-colors"
            />
          </div>

          {/* Business Type / Industry Selection */}
          <div>
            <label className="block text-xs font-semibold text-white/90 mb-2">
              Industry & Business Type <span className="text-[#F24E4B]">*</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {BUSINESS_TYPES.map((type) => {
                const isSelected = businessType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setBusinessType(type)}
                    className={`flex items-center justify-between p-2.5 rounded-lg border text-xs font-medium transition-all text-left ${
                      isSelected
                        ? "border-[#F24E4B] bg-[#F24E4B]/10 text-white font-semibold"
                        : "border-white/10 bg-white/[0.02] text-white/70 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    <span>{type}</span>
                    {isSelected && <Check className="size-3 text-[#F24E4B] stroke-[3]" />}
                  </button>
                );
              })}
            </div>

            {businessType === "Other" && (
              <div className="mt-3 animate-in fade-in">
                <input
                  type="text"
                  required
                  value={customBusinessType}
                  onChange={(e) => setCustomBusinessType(e.target.value)}
                  placeholder="Please specify your industry (e.g. Chemical Distribution, Automotive Parts)"
                  className="w-full rounded-lg border border-[#F24E4B]/40 bg-white/5 px-3.5 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B]"
                />
              </div>
            )}
          </div>

          {/* Company Size & Location */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-white/90 mb-1.5 flex items-center gap-1.5">
                <Users2 className="size-3.5 text-white/50" />
                <span>Company Size</span>
              </label>
              <select
                value={companySize}
                onChange={(e) => setCompanySize(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#14151B] px-3.5 py-2.5 text-xs text-white outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B]"
              >
                {COMPANY_SIZES.map((size) => (
                  <option key={size} value={size} className="bg-[#0D0E12] text-white">
                    {size}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-white/90 mb-1.5 flex items-center gap-1.5">
                <MapPin className="size-3.5 text-white/50" />
                <span>Operating Location / Country</span>
              </label>
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="e.g. Seattle, WA or United States"
                className="w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B]"
              />
            </div>
          </div>

          {/* Website */}
          <div>
            <label className="block text-xs font-semibold text-white/90 mb-1.5 flex items-center gap-1.5">
              <Globe className="size-3.5 text-white/50" />
              <span>Website <span className="text-white/40 font-normal">(optional)</span></span>
            </label>
            <input
              type="url"
              value={website}
              onChange={(e) => setWebsite(e.target.value)}
              placeholder="https://yourcompany.com"
              className="w-full rounded-lg border border-white/10 bg-white/5 px-3.5 py-2.5 text-xs text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B]"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-semibold text-white/90 mb-1.5 flex items-center gap-1.5">
              <FileText className="size-3.5 text-white/50" />
              <span>Short Organization Description</span>
            </label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe your primary wholesale distribution focus, product lines, or customer coverage..."
              className="w-full rounded-lg border border-white/10 bg-white/5 p-3 text-xs text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B] resize-none"
            />
          </div>

          {/* Submit Action */}
          <div className="pt-4 border-t border-white/10 flex items-center justify-between">
            <button
              type="button"
              onClick={() => router.push("/onboarding/checkout")}
              className="inline-flex items-center gap-1.5 text-xs text-white/60 hover:text-white px-3 py-2 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 transition-colors cursor-pointer"
            >
              <ArrowLeft className="size-3.5" />
              <span>Back</span>
            </button>

            <button
              type="submit"
              disabled={saving || !companyName.trim()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#F24E4B] hover:bg-[#d63f3c] text-white py-2.5 px-6 text-xs sm:text-sm font-semibold tracking-wide shadow-lg shadow-[#F24E4B]/20 disabled:opacity-50 transition-all cursor-pointer"
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Saving Identity...</span>
                </>
              ) : (
                <>
                  <span>Continue to Operations</span>
                  <ArrowRight className="size-4" />
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
