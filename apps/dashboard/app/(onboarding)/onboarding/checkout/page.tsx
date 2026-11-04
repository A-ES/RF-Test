"use client";

import { useEffect, useState, useTransition, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CreditCard,
  QrCode,
  ShieldCheck,
  Lock,
  ArrowRight,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  HelpCircle,
  RefreshCw,
} from "lucide-react";

interface PlanItem {
  id: string;
  slug: string;
  name: string;
  priceCents: number;
  currency: string;
  seatLimit: number;
}

function CheckoutContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedPlanId = searchParams.get("planId");

  const [plan, setPlan] = useState<PlanItem | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<"CARD" | "UPI">("CARD");
  const [loadingPlan, setLoadingPlan] = useState(true);

  // Card form state
  const [cardholderName, setCardholderName] = useState("Alex Morgan");
  const [cardNumber, setCardNumber] = useState("4242 4242 4242 4242");
  const [expiry, setExpiry] = useState("12/28");
  const [cvv, setCvv] = useState("123");

  // UPI form state
  const [upiId, setUpiId] = useState("alex.morgan@okaxis");

  // Transaction session state
  const [sessionReference, setSessionReference] = useState<string | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [paymentState, setPaymentState] = useState<"IDLE" | "PENDING" | "SUCCESS" | "FAILED">("IDLE");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successDetails, setSuccessDetails] = useState<string | null>(null);

  // Load plan details and initialize checkout session
  useEffect(() => {
    async function initCheckout() {
      try {
        const res = await fetch("/api/onboarding/status");
        if (!res.ok) throw new Error("Failed to load status");
        const data = await res.json();
        const availablePlans = data.plans || [];
        const targetPlan =
          availablePlans.find((p: PlanItem) => p.id === requestedPlanId) ||
          availablePlans.find((p: PlanItem) => p.slug === "rf-pro") ||
          availablePlans[0];

        if (targetPlan) {
          setPlan(targetPlan);
          await createSession(targetPlan.id, paymentMethod);
        }
      } catch (err) {
        console.error(err);
        setErrorMessage("Could not load checkout plan.");
      } finally {
        setLoadingPlan(false);
      }
    }

    initCheckout();
  }, [requestedPlanId]);

  async function createSession(planId: string, method: "CARD" | "UPI") {
    setSessionLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetch("/api/onboarding/checkout-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          planId,
          paymentMethod: method,
          idempotencyKey: `idem_${planId}_${method}`,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Session creation failed");
      }

      const data = await res.json();
      setSessionReference(data.session.reference);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to initialize payment session.");
    } finally {
      setSessionLoading(false);
    }
  }

  // Quick test helpers
  function fillSuccessCard() {
    setCardholderName("Jordan Ellis");
    setCardNumber("4242 4242 4242 4242");
    setExpiry("10/29");
    setCvv("789");
    setErrorMessage(null);
  }

  function fillDeclineCard() {
    setCardholderName("Jordan Ellis");
    setCardNumber("4000 0000 0000 0000"); // ends in 0000 to trigger decline
    setExpiry("10/29");
    setCvv("000");
    setErrorMessage(null);
  }

  function fillSuccessUpi() {
    setUpiId("jordan.wholesale@okhdfcbank");
    setErrorMessage(null);
  }

  function fillDeclineUpi() {
    setUpiId("decline.test@okaxis");
    setErrorMessage(null);
  }

  async function handlePaymentSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!sessionReference || !plan) return;

    setProcessing(true);
    setPaymentState("PENDING");
    setErrorMessage(null);

    try {
      const payload: any = {
        reference: sessionReference,
        planId: plan.id,
        paymentMethod,
      };

      if (paymentMethod === "CARD") {
        payload.cardDetails = {
          cardholderName,
          cardNumber,
          expiry,
          cvv,
        };
      } else {
        payload.upiDetails = {
          upiId,
        };
      }

      const res = await fetch("/api/onboarding/confirm-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setPaymentState("FAILED");
        setErrorMessage(data.error || "Simulated payment authorization failed.");
        return;
      }

      setPaymentState("SUCCESS");
      setSuccessDetails(data.maskedDetails || "Simulated Authorization Verified");

      // Auto-advance after 1.4s to Organization Identity step
      setTimeout(() => {
        router.push("/onboarding/identity");
      }, 1400);
    } catch (err: any) {
      setPaymentState("FAILED");
      setErrorMessage(err.message || "Network error during simulated payment.");
    } finally {
      setProcessing(false);
    }
  }

  if (loadingPlan) {
    return (
      <div className="py-20 flex flex-col items-center justify-center text-center">
        <div className="size-8 rounded-full border-2 border-[#F24E4B] border-t-transparent animate-spin mb-4" />
        <p className="text-sm text-white/60 font-mono">Initializing secure checkout session...</p>
      </div>
    );
  }

  const priceAmount = plan ? (plan.priceCents / 100).toFixed(0) : "0";

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      {/* Header */}
      <div className="text-center max-w-2xl mx-auto space-y-2">
        <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#F24E4B]/10 border border-[#F24E4B]/30 text-[#F24E4B] text-xs font-mono font-medium">
          <Lock className="size-3.5" />
          <span>STEP 2 OF 6 &bull; SIMULATED PAYMENT CHECKOUT</span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Complete workspace subscription
        </h1>
        <p className="text-xs sm:text-sm text-white/60 max-w-lg mx-auto">
          Test simulated gateway authorization. No real credit card or bank account will ever be charged.
        </p>
      </div>

      {/* Gateway Simulation Banner */}
      <div className="max-w-2xl mx-auto rounded-xl border border-sky-500/30 bg-sky-500/10 p-3.5 flex items-start gap-3 text-xs text-sky-200">
        <ShieldCheck className="size-4 shrink-0 text-sky-400 mt-0.5" />
        <div>
          <span className="font-semibold text-sky-300">Provider-Independent Sandbox:</span>{" "}
          This checkout tests the simulated payment provider layer. Real credentials and CVV are never stored, logged, or transmitted.
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-4xl mx-auto">
        {/* Left Column: Payment Methods & Form (7 cols) */}
        <div className="lg:col-span-7 rounded-2xl border border-white/10 bg-[#0D0E12] p-6 shadow-xl relative">
          {/* Payment Method Selector Tabs */}
          <div className="grid grid-cols-2 gap-3 mb-6 p-1 rounded-xl bg-white/5 border border-white/5">
            <button
              type="button"
              onClick={() => {
                setPaymentMethod("CARD");
                if (plan) void createSession(plan.id, "CARD");
              }}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                paymentMethod === "CARD"
                  ? "bg-[#F24E4B] text-white shadow-md shadow-[#F24E4B]/20"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <CreditCard className="size-4" />
              <span>Credit / Debit Card</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setPaymentMethod("UPI");
                if (plan) void createSession(plan.id, "UPI");
              }}
              className={`flex items-center justify-center gap-2 py-2.5 px-3 rounded-lg text-xs font-semibold transition-all ${
                paymentMethod === "UPI"
                  ? "bg-[#F24E4B] text-white shadow-md shadow-[#F24E4B]/20"
                  : "text-white/60 hover:text-white"
              }`}
            >
              <QrCode className="size-4" />
              <span>Instant UPI</span>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handlePaymentSubmit} className="space-y-4">
            {paymentMethod === "CARD" ? (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between text-xs text-white/50 mb-1">
                  <span>Card Information</span>
                  <div className="flex gap-2 font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={fillSuccessCard}
                      className="text-sky-400 hover:underline"
                    >
                      Fill Valid Test Card
                    </button>
                    <span>&bull;</span>
                    <button
                      type="button"
                      onClick={fillDeclineCard}
                      className="text-amber-400 hover:underline"
                    >
                      Fill Decline Card
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Cardholder Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={cardholderName}
                    onChange={(e) => setCardholderName(e.target.value)}
                    placeholder="Name on card"
                    className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B]"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    Card Number (Test Simulation)
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={cardNumber}
                      onChange={(e) => setCardNumber(e.target.value)}
                      placeholder="4242 4242 4242 4242"
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B]"
                    />
                    <CreditCard className="size-4 text-white/40 absolute right-3 top-2.5 pointer-events-none" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      Expiry (MM/YY)
                    </label>
                    <input
                      type="text"
                      required
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                      placeholder="12/28"
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B]"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-white/70 mb-1">
                      CVV / CVC
                    </label>
                    <input
                      type="password"
                      required
                      maxLength={4}
                      value={cvv}
                      onChange={(e) => setCvv(e.target.value)}
                      placeholder="•••"
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B]"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3.5">
                <div className="flex items-center justify-between text-xs text-white/50 mb-1">
                  <span>Virtual Payment Address (VPA)</span>
                  <div className="flex gap-2 font-mono text-[10px]">
                    <button
                      type="button"
                      onClick={fillSuccessUpi}
                      className="text-sky-400 hover:underline"
                    >
                      Fill Valid UPI
                    </button>
                    <span>&bull;</span>
                    <button
                      type="button"
                      onClick={fillDeclineUpi}
                      className="text-amber-400 hover:underline"
                    >
                      Fill Decline UPI
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-medium text-white/70 mb-1">
                    UPI ID / VPA
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      required
                      value={upiId}
                      onChange={(e) => setUpiId(e.target.value)}
                      placeholder="username@bank"
                      className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs font-mono text-white placeholder-white/30 outline-none focus:border-[#F24E4B] focus:ring-1 focus:ring-[#F24E4B]"
                    />
                    <QrCode className="size-4 text-white/40 absolute right-3 top-2.5 pointer-events-none" />
                  </div>
                </div>

                <div className="p-3 rounded-lg bg-white/[0.02] border border-white/5 text-[11px] text-white/60 space-y-1">
                  <p className="font-semibold text-white/80">UPI Collect Simulation:</p>
                  <p>In simulation mode, clicking Confirm Payment immediately evaluates the UPI request without external notification lag.</p>
                </div>
              </div>
            )}

            {/* Error state */}
            {errorMessage && (
              <div className="rounded-lg border border-[#F24E4B]/40 bg-[#F24E4B]/10 p-3 text-xs text-[#F24E4B] flex items-start gap-2">
                <XCircle className="size-4 shrink-0 mt-0.5" />
                <span>{errorMessage}</span>
              </div>
            )}

            {/* Success state */}
            {paymentState === "SUCCESS" && (
              <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-300 flex items-start gap-2">
                <CheckCircle2 className="size-4 shrink-0 text-emerald-400 mt-0.5" />
                <div>
                  <span className="font-semibold">Simulated Payment Approved!</span>
                  <div className="text-[11px] text-emerald-200/80 mt-0.5">
                    {successDetails}. Advancing to organization identity...
                  </div>
                </div>
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={processing || sessionLoading || paymentState === "SUCCESS"}
              className="w-full mt-4 flex items-center justify-center gap-2 rounded-lg bg-[#F24E4B] hover:bg-[#d63f3c] text-white py-2.5 px-4 text-xs sm:text-sm font-semibold tracking-wide transition-all shadow-lg shadow-[#F24E4B]/20 disabled:opacity-50"
            >
              {processing ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  <span>Authorizing Simulated Payment...</span>
                </>
              ) : paymentState === "SUCCESS" ? (
                <>
                  <CheckCircle2 className="size-4" />
                  <span>Payment Succeeded</span>
                </>
              ) : (
                <>
                  <Lock className="size-3.5" />
                  <span>Authorize ${priceAmount} / mo (Simulated)</span>
                </>
              )}
            </button>
          </form>

          <div className="mt-4 pt-4 border-t border-white/5 flex items-center justify-between text-[11px] text-white/40 font-mono">
            <span>Reference: {sessionReference || "pending..."}</span>
            <span>256-bit Sandbox TLS</span>
          </div>
        </div>

        {/* Right Column: Order Summary (5 cols) */}
        <div className="lg:col-span-5 rounded-2xl border border-white/10 bg-[#0B0C10] p-6 flex flex-col justify-between">
          <div>
            <h3 className="text-sm font-bold text-white tracking-tight mb-4 flex items-center justify-between">
              <span>Order Summary</span>
              <span className="text-[10px] font-mono font-medium text-emerald-400 bg-emerald-400/10 px-2 py-0.5 rounded border border-emerald-400/20">
                ACTIVE CHECKOUT
              </span>
            </h3>

            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 space-y-3 mb-4">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-white text-sm block">
                    {plan?.name} Plan
                  </span>
                  <span className="text-xs text-white/50 font-mono">
                    Up to {plan?.slug === "rf-ultra" ? 10 : 4} additional team seats
                  </span>
                </div>
                <span className="text-base font-bold text-white">${priceAmount}</span>
              </div>

              <div className="pt-2 border-t border-white/5 flex items-center justify-between text-xs text-white/60">
                <span>Billing Interval</span>
                <span className="font-mono text-white/90">Monthly Recurring</span>
              </div>

              <div className="flex items-center justify-between text-xs text-white/60">
                <span>Sales Tax / VAT</span>
                <span className="font-mono text-emerald-400">$0.00 (Sandbox)</span>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-white/5 bg-white/[0.02] space-y-2 text-xs text-white/70">
              <span className="text-[11px] font-mono uppercase tracking-wider text-white/40 block">
                Subscription Inclusions:
              </span>
              <p>&bull; Immediate workspace provisioning</p>
              <p>&bull; Team member invites up to plan limit</p>
              <p>&bull; Operational alerts & intelligence feed</p>
              <p>&bull; Can be canceled or upgraded at any time</p>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-white/10 flex items-center justify-between text-xs">
            <span className="text-white/60">Plan Selection:</span>
            <button
              type="button"
              onClick={() => router.push("/onboarding/plan")}
              className="text-[#F24E4B] hover:underline font-medium inline-flex items-center gap-1"
            >
              <RefreshCw className="size-3" /> Change Plan
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CheckoutPage() {
  return (
    <Suspense
      fallback={
        <div className="py-20 flex flex-col items-center justify-center text-center">
          <div className="size-8 rounded-full border-2 border-[#F24E4B] border-t-transparent animate-spin mb-4" />
          <p className="text-sm text-white/60 font-mono">Loading checkout...</p>
        </div>
      }
    >
      <CheckoutContent />
    </Suspense>
  );
}
