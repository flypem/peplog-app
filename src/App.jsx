import React, { useState, useEffect, useMemo } from "react";
import {
  FlaskConical,
  Package,
  Clock,
  Plus,
  Trash2,
  MapPin,
  AlertTriangle,
  DollarSign,
  ChevronRight,
  X,
  Check,
  Lock,
  Crown,
  Download,
  Bell,
  Settings as SettingsIcon,
  TrendingUp,
  CalendarClock,
  Pencil,
  SlidersHorizontal,
  Pill,
  Droplet,
  LogOut,
} from "lucide-react";
import { supabase } from "./lib/supabaseClient";
import { loadKey, saveKey } from "./lib/storage";
import { fetchPlan, ensureProfileExists } from "./lib/profile";
import { startCheckout, openBillingPortal } from "./lib/stripe";
import Auth from "./Auth";

// ---------- constants ----------
const DEFAULT_SITES = [
  "Abdomen — L",
  "Abdomen — R",
  "Thigh — L",
  "Thigh — R",
  "Love handle — L",
  "Love handle — R",
];

const SYRINGE_SCALES = [30, 50, 100]; // U-100 insulin syringe sizes: 0.3mL, 0.5mL, 1mL
const FREE_VIAL_LIMIT = 1;
const PRICE = "$6/mo";
const PRICE_ANNUAL = "$48/yr";
const MS_WEEK = 7 * 24 * 3600 * 1000;

const INK = "#1C2B33";
const TEAL = "#127D77";
const AMBER = "#C97A2E";
const PAPER = "#FAFAF8";
const LINE = "#DEDBD2";

// ---------- helpers ----------
const toMcg = (val, unit) => (unit === "mg" ? val * 1000 : val); // capsule/mcg pass through unchanged
const uid = () => Math.random().toString(36).slice(2, 10);
const fmt = (n, d = 1) =>
  Number.isFinite(n) ? n.toLocaleString(undefined, { maximumFractionDigits: d }) : "—";

function pickScale(units) {
  const found = SYRINGE_SCALES.find((s) => units <= s);
  return found || 100;
}

// Respects the user's preferred syringe size, but falls back to auto-fit
// if the dose genuinely doesn't fit that syringe — never draw an overflowing gauge.
function resolveScale(units, pref) {
  if (pref && pref !== "auto") {
    const preferred = parseInt(pref, 10);
    if (SYRINGE_SCALES.includes(preferred) && units <= preferred) return preferred;
  }
  return pickScale(units);
}

function fmtConc(mcgPerMl) {
  if (mcgPerMl >= 1000) return `${fmt(mcgPerMl / 1000, 2)} mg/mL`;
  return `${fmt(mcgPerMl, 0)} mcg/mL`;
}

// item type helpers — 'vial' (reconstitute), 'premixed' (already liquid), 'capsule' (oral)
function getType(v) { return v.type || "vial"; }
function isInjectable(type) { return type !== "capsule"; }
function unitWord(type) {
  if (type === "capsule") return "bottle";
  return "vial";
}
function typeIcon(type) {
  if (type === "capsule") return Pill;
  if (type === "premixed") return Droplet;
  return FlaskConical;
}

function nextSite(log, sites) {
  const injLog = log.filter((e) => e.site);
  if (!injLog.length) return sites[0];
  const idx = sites.indexOf(injLog[0].site);
  return idx === -1 ? sites[0] : sites[(idx + 1 + sites.length) % sites.length];
}

function csvEscape(val) {
  const s = String(val ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportCSV(log) {
  const header = "Date,Item,Site,Dose,Notes\n";
  const rows = log
    .map((e) => [new Date(e.date).toISOString(), e.name, e.site || "", `${e.doseAmount}${e.doseUnit}`, e.notes || ""].map(csvEscape).join(","))
    .join("\n");
  const blob = new Blob([header + rows], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "flyptide-history.csv";
  a.click();
  URL.revokeObjectURL(url);
}

// ---------- dose-schedule (titration) helpers ----------
// A vial's dose can change over time. Step 1 is the vial's base doseAmount/doseUnit.
// v.titration holds any additional steps: [{ amount, unit, weeks }]. The last step's
// weeks can be blank, meaning "continue at this dose indefinitely" (maintenance).
function buildSteps(v) {
  const extra = v.titration || [];
  const hasTitration = extra.length > 0;
  const first = {
    amount: parseFloat(v.doseAmount) || 0,
    unit: v.doseUnit,
    weeks: hasTitration ? parseFloat(v.step1Weeks) || 1 : Infinity,
  };
  const rest = extra.map((s, i) => ({
    amount: parseFloat(s.amount) || 0,
    unit: s.unit,
    weeks: i === extra.length - 1 ? parseFloat(s.weeks) || Infinity : parseFloat(s.weeks) || 1,
  }));
  return [first, ...rest].map((s) => ({ ...s, doseMcg: toMcg(s.amount, s.unit) }));
}

function stepPosition(steps, createdAt, now) {
  const elapsedWeeks = Math.max(0, (now - new Date(createdAt).getTime()) / MS_WEEK);
  let cum = 0;
  for (let i = 0; i < steps.length; i++) {
    const w = steps[i].weeks;
    if (w === Infinity || elapsedWeeks < cum + w) {
      return { idx: i, weeksIntoStep: elapsedWeeks - cum, cumBefore: cum };
    }
    cum += w;
  }
  const last = steps.length - 1;
  return { idx: last, weeksIntoStep: elapsedWeeks - cum, cumBefore: cum };
}

function nextChangeDate(steps, createdAtMs, pos) {
  if (pos.idx >= steps.length - 1) return null;
  const step = steps[pos.idx];
  return new Date(createdAtMs + (pos.cumBefore + step.weeks) * MS_WEEK);
}

function simulateDaysRemaining(steps, freq, pos, mcgAvailable) {
  if (!(freq > 0) || mcgAvailable <= 0) return 0;
  const doseIntervalDays = 7 / freq;
  let idx = pos.idx;
  let weeksIntoStep = pos.weeksIntoStep;
  let mcgLeft = mcgAvailable;
  let days = 0;
  let guard = 0;
  while (mcgLeft > 0 && guard < 5000) {
    guard++;
    const step = steps[idx];
    if (step.doseMcg <= 0) break;
    const weeksRemainingInStep = step.weeks === Infinity ? Infinity : Math.max(0, step.weeks - weeksIntoStep);
    const dosesRemainingInStep = weeksRemainingInStep === Infinity ? Infinity : Math.floor(weeksRemainingInStep * freq);
    let count = 0;
    while (mcgLeft > 0 && (dosesRemainingInStep === Infinity || count < dosesRemainingInStep)) {
      mcgLeft -= step.doseMcg;
      days += doseIntervalDays;
      count++;
    }
    if (mcgLeft <= 0 || idx >= steps.length - 1) break;
    idx++;
    weeksIntoStep = 0;
  }
  return days;
}

// ---------- storage ----------
// loadKey/saveKey are now imported from ./lib/storage (Supabase-backed).

// ---------- Syringe visual ----------
function SyringeGauge({ units, scale }) {
  const h = 220;
  const w = 80;
  const fillH = Math.max(0, Math.min(1, units / scale)) * (h - 20);
  const ticks = [];
  const step = scale <= 30 ? 5 : 10;
  for (let u = 0; u <= scale; u += step) {
    const y = 10 + (h - 20) * (1 - u / scale);
    ticks.push({ u, y });
  }
  return (
    <svg width={w} height={h + 30} viewBox={`0 0 ${w} ${h + 30}`}>
      <rect x={16} y={10} width={32} height={h - 20} rx={4} fill="white" stroke={INK} strokeWidth={1.5} />
      <rect x={17} y={10 + (h - 20 - fillH)} width={30} height={fillH} fill={TEAL} opacity={0.85} rx={2} />
      <rect x={12} y={h - 6} width={40} height={10} rx={2} fill={INK} />
      {ticks.map(({ u, y }) => (
        <g key={u}>
          <line x1={48} y1={y} x2={56} y2={y} stroke={INK} strokeWidth={1} />
          <text x={60} y={y + 3} fontSize={9} fontFamily="ui-monospace, monospace" fill={INK}>{u}</text>
        </g>
      ))}
      <rect x={29} y={0} width={6} height={12} fill={INK} />
    </svg>
  );
}

// ---------- main app ----------
export default function Flyptide() {
  const [session, setSession] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [tab, setTab] = useState("calc");
  const [vials, setVials] = useState([]);
  const [log, setLog] = useState([]);
  const [plan, setPlan] = useState("free");
  const [cancelAtPeriodEnd, setCancelAtPeriodEnd] = useState(false);
  const [currentPeriodEnd, setCurrentPeriodEnd] = useState(null);
  const [customSites, setCustomSites] = useState([]);
  const [syringePref, setSyringePref] = useState("auto"); // "auto" | "30" | "50" | "100"
  const [ready, setReady] = useState(false);
  const [paywall, setPaywall] = useState(null);

  // calculator state
  const [itemType, setItemType] = useState("vial");
  const [vialAmount, setVialAmount] = useState("");
  const [vialUnit, setVialUnit] = useState("mg");
  const [bacWater, setBacWater] = useState("");
  const [doseAmount, setDoseAmount] = useState("");
  const [doseUnit, setDoseUnit] = useState("mcg");
  const [freq, setFreq] = useState("7");
  const [peptideName, setPeptideName] = useState("");
  const [costPerVial, setCostPerVial] = useState("");
  const [vialsInStock, setVialsInStock] = useState("1");
  const [step1Weeks, setStep1Weeks] = useState("");
  const [scheduleSteps, setScheduleSteps] = useState([]);
  const [solveMode, setSolveMode] = useState("water"); // "water" (normal) or "units" (reverse-solve)
  const [desiredUnits, setDesiredUnits] = useState("");

  const [logModalVial, setLogModalVial] = useState(null);
  const [editingVial, setEditingVial] = useState(null);
  const [changeDoseVial, setChangeDoseVial] = useState(null);

  // auth: pick up the existing session (if any) and listen for sign-in/out
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // load this user's data once signed in
  useEffect(() => {
    if (!session) return;
    (async () => {
      await ensureProfileExists();
      const v = await loadKey("flyptide:vials", []);
      const l = await loadKey("flyptide:log", []);
      const p = await fetchPlan();
      const cs = await loadKey("flyptide:customSites", []);
      const sp = await loadKey("flyptide:syringePref", "auto");
      setVials(v);
      setLog(l);
      setPlan(p.plan);
      setCancelAtPeriodEnd(p.cancelAtPeriodEnd);
      setCurrentPeriodEnd(p.currentPeriodEnd);
      setCustomSites(cs);
      setSyringePref(sp);
      setReady(true);
    })();
  }, [session]);

  // returning from Stripe Checkout: poll briefly for the webhook to land
  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("checkout") !== "success") return;
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const p = await fetchPlan();
      if (p.plan === "pro" || attempts >= 6) {
        setPlan(p.plan);
        setCancelAtPeriodEnd(p.cancelAtPeriodEnd);
        setCurrentPeriodEnd(p.currentPeriodEnd);
        clearInterval(poll);
        window.history.replaceState({}, "", window.location.pathname);
      }
    }, 1500);
    return () => clearInterval(poll);
  }, [session]);

  // returning from the Billing Portal (e.g. after cancelling): refresh status.
  // Polls a few times rather than once, since Stripe's webhook can take a
  // second or two to land — a single immediate fetch can grab stale data.
  useEffect(() => {
    if (!session) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("billing") !== "return") return;
    window.history.replaceState({}, "", window.location.pathname);
    let attempts = 0;
    const poll = setInterval(async () => {
      attempts++;
      const p = await fetchPlan();
      setPlan(p.plan);
      setCancelAtPeriodEnd(p.cancelAtPeriodEnd);
      setCurrentPeriodEnd(p.currentPeriodEnd);
      if (attempts >= 5) clearInterval(poll);
    }, 1500);
    return () => clearInterval(poll);
  }, [session]);

  useEffect(() => { if (ready) saveKey("flyptide:vials", vials); }, [vials, ready]);
  useEffect(() => { if (ready) saveKey("flyptide:log", log); }, [log, ready]);
  useEffect(() => { if (ready) saveKey("flyptide:customSites", customSites); }, [customSites, ready]);
  useEffect(() => { if (ready) saveKey("flyptide:syringePref", syringePref); }, [syringePref, ready]);

  async function signOut() {
    await supabase.auth.signOut();
    setReady(false);
    setVials([]);
    setLog([]);
    setPlan("free");
    setCustomSites([]);
  }

  const isPro = plan === "pro";
  const allSites = useMemo(() => [...DEFAULT_SITES, ...customSites], [customSites]);

  function addCustomSite(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    setCustomSites((prev) => (prev.includes(trimmed) || DEFAULT_SITES.includes(trimmed) ? prev : [...prev, trimmed]));
  }
  function removeCustomSite(name) {
    setCustomSites((prev) => prev.filter((s) => s !== name));
  }

  const calc = useMemo(() => {
    const dMcg = toMcg(parseFloat(doseAmount) || 0, doseUnit);
    const desiredUnitsNum = parseFloat(desiredUnits) || 0;
    let water = parseFloat(bacWater) || 0;
    let conc, vMcg, solvedWater = null;

    if (itemType === "premixed") {
      conc = toMcg(parseFloat(vialAmount) || 0, vialUnit);
      vMcg = conc * water;
    } else {
      vMcg = toMcg(parseFloat(vialAmount) || 0, vialUnit);
      if (itemType === "vial" && solveMode === "units" && dMcg > 0 && desiredUnitsNum > 0) {
        // reverse-solve: given a target dose and desired draw, back into the water needed
        solvedWater = (vMcg * desiredUnitsNum) / (100 * dMcg);
        water = solvedWater;
      }
      conc = water > 0 ? vMcg / water : 0;
    }
    const doseMl = conc > 0 ? dMcg / conc : 0;
    const units = doseMl * 100;
    const totalDoses = dMcg > 0 ? vMcg / dMcg : 0;
    const f = parseFloat(freq) || 0;
    const daysSupply = f > 0 && totalDoses > 0 ? (totalDoses / f) * 7 : 0;
    const cost = parseFloat(costPerVial) || 0;
    const costPerDose = totalDoses > 0 && cost > 0 ? cost / totalDoses : 0;
    return { vMcg, water, dMcg, conc, doseMl, units, totalDoses, daysSupply, costPerDose, solvedWater };
  }, [itemType, vialAmount, vialUnit, bacWater, doseAmount, doseUnit, freq, costPerVial, solveMode, desiredUnits]);

  const valid = solveMode === "units" ? calc.solvedWater > 0 && calc.dMcg > 0 : calc.conc > 0 && calc.dMcg > 0;
  const scale = resolveScale(calc.units || 0, syringePref);
  const overfill = itemType !== "capsule" && valid && calc.units > 100;

  function selectType(t) {
    setItemType(t);
    if (t === "capsule") {
      setVialUnit("capsule");
      setDoseUnit("capsule");
      setBacWater("1");
    } else {
      setVialUnit((u) => (u === "capsule" ? "mg" : u));
      setDoseUnit((u) => (u === "capsule" ? "mcg" : u));
      setBacWater((w) => (w === "1" ? "" : w));
    }
  }

  function saveVial() {
    if (!isPro && vials.length >= FREE_VIAL_LIMIT) {
      setPaywall("vials");
      return;
    }
    const type = itemType;
    const effUnit = type === "capsule" ? "capsule" : vialUnit;
    const effDoseUnit = type === "capsule" ? "capsule" : doseUnit;
    const effWater = type === "capsule" ? 1 : (solveMode === "units" && calc.solvedWater > 0 ? calc.solvedWater : parseFloat(bacWater) || 0);
    const effAmount = type === "premixed" ? (parseFloat(vialAmount) || 0) * effWater : parseFloat(vialAmount) || 0;
    const v = {
      id: uid(),
      type,
      name: peptideName || (type === "capsule" ? "Untitled supplement" : "Untitled peptide"),
      vialAmount: effAmount,
      vialUnit: effUnit,
      bacWater: effWater,
      doseAmount: parseFloat(doseAmount) || 0,
      doseUnit: effDoseUnit,
      freq: parseFloat(freq) || 0,
      costPerVial: parseFloat(costPerVial) || 0,
      vialsInStock: Math.max(1, parseInt(vialsInStock, 10) || 1),
      vialsOpened: 1,
      dosesUsed: 0,
      mcgUsedCurrentVial: 0,
      mcgUsedTotal: 0,
      remindersOn: false,
      step1Weeks: scheduleSteps.length ? step1Weeks : "",
      titration: scheduleSteps.map((s) => ({ amount: s.amount, unit: type === "capsule" ? "capsule" : s.unit, weeks: s.weeks })),
      createdAt: new Date().toISOString(),
    };
    setVials((prev) => [v, ...prev]);
    setScheduleSteps([]);
    setStep1Weeks("");
    setSolveMode("water");
    setDesiredUnits("");
    setTab("inventory");
  }

  function startNextVial(v) {
    setVials((prev) => prev.map((x) => (x.id === v.id ? { ...x, mcgUsedCurrentVial: 0, vialsOpened: x.vialsOpened + 1, dosesUsed: 0 } : x)));
  }

  function restockVial(v) {
    setVials((prev) => prev.map((x) => (x.id === v.id ? { ...x, vialsInStock: x.vialsInStock + 1 } : x)));
  }

  function removeVial(id) {
    setVials((prev) => prev.filter((v) => v.id !== id));
  }

  function toggleReminder(v) {
    if (!isPro) { setPaywall("reminders"); return; }
    setVials((prev) => prev.map((x) => (x.id === v.id ? { ...x, remindersOn: !x.remindersOn } : x)));
  }

  function logDose(vial, site, whenIso, notes) {
    const when = whenIso ? new Date(whenIso) : new Date();
    const now = when.getTime();
    const steps = buildSteps(vial);
    const pos = stepPosition(steps, vial.createdAt, now);
    const step = steps[pos.idx];
    const entry = {
      id: uid(),
      vialId: vial.id,
      name: vial.name,
      site: site || null,
      doseAmount: step.amount,
      doseUnit: step.unit,
      date: when.toISOString(),
      notes: notes || "",
    };
    setLog((prev) => [entry, ...prev].sort((a, b) => new Date(b.date) - new Date(a.date)));
    setVials((prev) => prev.map((v) => (v.id === vial.id ? {
      ...v,
      dosesUsed: (v.dosesUsed || 0) + 1,
      mcgUsedCurrentVial: (v.mcgUsedCurrentVial || 0) + step.doseMcg,
      mcgUsedTotal: (v.mcgUsedTotal || 0) + step.doseMcg,
    } : v)));
    setLogModalVial(null);
  }

  function vialStats(v) {
    const now = Date.now();
    const type = getType(v);
    const vMcg = toMcg(v.vialAmount, v.vialUnit);
    const steps = buildSteps(v);
    const pos = stepPosition(steps, v.createdAt, now);
    const currentStep = steps[pos.idx];
    const changeDate = nextChangeDate(steps, new Date(v.createdAt).getTime(), pos);
    const nextStep = pos.idx < steps.length - 1 ? steps[pos.idx + 1] : null;
    const weekNumber = Math.floor(pos.cumBefore + pos.weeksIntoStep) + 1;

    const mcgUsedCurrentVial = v.mcgUsedCurrentVial || 0;
    const remainingMcg = Math.max(0, vMcg - mcgUsedCurrentVial);
    const remaining = currentStep.doseMcg > 0 ? remainingMcg / currentStep.doseMcg : 0;
    const daysLeft = simulateDaysRemaining(steps, v.freq, pos, remainingMcg);
    const pct = vMcg > 0 ? remainingMcg / vMcg : 0;
    const isEmpty = remainingMcg < currentStep.doseMcg - 1e-9;

    const vialsInStock = v.vialsInStock || 1;
    const vialsOpened = v.vialsOpened || 1;
    const unopenedVials = Math.max(0, vialsInStock - vialsOpened);
    const stockRemainingMcg = remainingMcg + unopenedVials * vMcg;
    const stockDaysLeft = simulateDaysRemaining(steps, v.freq, pos, stockRemainingMcg);

    const costPerMcg = vMcg > 0 && v.costPerVial > 0 ? v.costPerVial / vMcg : 0;
    const spent = (v.mcgUsedTotal || 0) * costPerMcg;
    const costPerDose = costPerMcg * currentStep.doseMcg;

    const conc = v.bacWater > 0 ? vMcg / v.bacWater : 0;
    const currentDoseMl = conc > 0 ? currentStep.doseMcg / conc : 0;
    const currentUnits = currentDoseMl * 100;
    const isTitrating = (v.titration || []).length > 0;

    return {
      type, vMcg, currentStep, changeDate, nextStep, weekNumber,
      remaining, daysLeft, costPerDose, pct, spent, isEmpty,
      vialsInStock, vialsOpened, unopenedVials, stockDaysLeft,
      conc, currentDoseMl, currentUnits, isTitrating,
    };
  }

  function handleExport() {
    if (!isPro) { setPaywall("export"); return; }
    if (!log.length) return;
    exportCSV(log);
  }

  if (!authChecked) {
    return <div style={{ background: PAPER, minHeight: "100vh" }} />;
  }
  if (!session) {
    return <Auth />;
  }

  return (
    <div style={{ background: PAPER, minHeight: "100vh", color: INK, fontFamily: "ui-sans-serif, system-ui, sans-serif" }} className="flex flex-col">
      <header className="px-5 pt-6 pb-4 border-b flex items-center justify-between" style={{ borderColor: LINE }}>
        <div>
          <div className="flex items-center gap-2">
            <FlaskConical size={22} color={TEAL} strokeWidth={2} />
            <h1 className="text-xl font-semibold tracking-tight">Flyptide</h1>
            <PlanBadge isPro={isPro} />
          </div>
          <p className="text-sm mt-0.5" style={{ color: "#6B7680" }}>Dosing math, supply tracking, dose log.</p>
        </div>
      </header>

      <main className="flex-1 px-5 py-5 pb-28 max-w-md w-full mx-auto">
        {tab === "calc" && (
          <CalcTab {...{
            itemType, selectType,
            peptideName, setPeptideName, vialAmount, setVialAmount, vialUnit, setVialUnit,
            bacWater, setBacWater, doseAmount, setDoseAmount, doseUnit, setDoseUnit,
            freq, setFreq, costPerVial, setCostPerVial, vialsInStock, setVialsInStock,
            step1Weeks, setStep1Weeks, scheduleSteps, setScheduleSteps,
            solveMode, setSolveMode, desiredUnits, setDesiredUnits,
            calc, valid, scale, overfill, saveVial,
          }} />
        )}
        {tab === "inventory" && (
          <InventoryTab
            vials={vials}
            vialStats={vialStats}
            isPro={isPro}
            onAdd={() => setTab("calc")}
            onRemove={removeVial}
            onLog={(v) => setLogModalVial(v)}
            onToggleReminder={toggleReminder}
            onStartNextVial={startNextVial}
            onRestock={restockVial}
            onEdit={(v) => setEditingVial(v)}
            onChangeDose={(v) => setChangeDoseVial(v)}
          />
        )}
        {tab === "log" && <LogTab log={log} isPro={isPro} onExport={handleExport} />}
        {tab === "account" && (
          <AccountTab
            isPro={isPro}
            cancelAtPeriodEnd={cancelAtPeriodEnd}
            currentPeriodEnd={currentPeriodEnd}
            vials={vials}
            vialStats={vialStats}
            log={log}
            customSites={customSites}
            userEmail={session.user.email}
            syringePref={syringePref}
            setSyringePref={setSyringePref}
            onAddSite={addCustomSite}
            onRemoveSite={removeCustomSite}
            onUpgrade={(interval) => startCheckout(interval).catch((e) => alert(e.message))}
            onDowngrade={() => openBillingPortal().catch((e) => alert(e.message))}
            onExport={handleExport}
            onSignOut={signOut}
          />
        )}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 border-t flex justify-around py-2" style={{ background: PAPER, borderColor: LINE }}>
        {[
          { id: "calc", label: "Calculator", icon: FlaskConical },
          { id: "inventory", label: "Inventory", icon: Package },
          { id: "log", label: "Log", icon: Clock },
          { id: "account", label: "Account", icon: SettingsIcon },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setTab(id)} className="flex flex-col items-center gap-1 px-4 py-1 rounded-lg" style={{ color: tab === id ? TEAL : "#8A9299" }}>
            <Icon size={20} strokeWidth={tab === id ? 2.4 : 1.8} />
            <span className="text-[11px] font-medium">{label}</span>
          </button>
        ))}
      </nav>

      {logModalVial && (
        <LogModal
          vial={logModalVial}
          stats={vialStats(logModalVial)}
          sites={allSites}
          suggested={nextSite(log, allSites)}
          syringePref={syringePref}
          onClose={() => setLogModalVial(null)}
          onConfirm={(site, whenIso, notes) => logDose(logModalVial, site, whenIso, notes)}
          onAddSite={addCustomSite}
        />
      )}

      {paywall && (
        <PaywallModal feature={paywall} onClose={() => setPaywall(null)} onUpgrade={(interval) => { setPaywall(null); startCheckout(interval).catch((e) => alert(e.message)); }} />
      )}

      {editingVial && (
        <EditScheduleModal
          vial={editingVial}
          onClose={() => setEditingVial(null)}
          onSave={(patch) => { setVials((prev) => prev.map((x) => (x.id === editingVial.id ? { ...x, ...patch } : x))); setEditingVial(null); }}
        />
      )}

      {changeDoseVial && (
        <ChangeDoseModal
          vial={changeDoseVial}
          stats={vialStats(changeDoseVial)}
          syringePref={syringePref}
          onClose={() => setChangeDoseVial(null)}
          onSave={(amt, unit) => {
            const vial = changeDoseVial;
            const now = Date.now();
            const steps = buildSteps(vial);
            const pos = stepPosition(steps, vial.createdAt, now);
            const truncated = steps.slice(0, pos.idx + 1).map((s, i) =>
              i === pos.idx ? { ...s, weeks: Math.round(pos.weeksIntoStep * 100) / 100 } : s
            );
            const finalSteps = [...truncated, { amount: amt, unit, weeks: Infinity }];
            const rest = finalSteps.slice(1);
            const patch = {
              doseAmount: finalSteps[0].amount,
              doseUnit: finalSteps[0].unit,
              step1Weeks: rest.length ? String(finalSteps[0].weeks) : "",
              titration: rest.map((s) => ({ amount: s.amount, unit: s.unit, weeks: s.weeks === Infinity ? "" : String(s.weeks) })),
            };
            setVials((prev) => prev.map((x) => (x.id === vial.id ? { ...x, ...patch } : x)));
            setChangeDoseVial(null);
          }}
        />
      )}
    </div>
  );
}

function PlanBadge({ isPro }) {
  return (
    <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full flex items-center gap-0.5" style={{ background: isPro ? "#FBF0DD" : "#EEF0F1", color: isPro ? AMBER : "#8A9299" }}>
      {isPro && <Crown size={9} />}
      {isPro ? "PRO" : "FREE"}
    </span>
  );
}

// ---------- Calculator tab ----------
function CalcTab(props) {
  const {
    itemType, selectType,
    peptideName, setPeptideName, vialAmount, setVialAmount, vialUnit, setVialUnit,
    bacWater, setBacWater, doseAmount, setDoseAmount, doseUnit, setDoseUnit,
    freq, setFreq, costPerVial, setCostPerVial, vialsInStock, setVialsInStock,
    step1Weeks, setStep1Weeks, scheduleSteps, setScheduleSteps,
    solveMode, setSolveMode, desiredUnits, setDesiredUnits,
    calc, valid, scale, overfill, saveVial,
  } = props;

  const isCapsule = itemType === "capsule";

  function addStep() {
    setScheduleSteps((prev) => [...prev, { id: uid(), amount: "", unit: isCapsule ? "capsule" : doseUnit, weeks: "" }]);
  }
  function updateStep(i, patch) {
    setScheduleSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  function removeStep(i) {
    setScheduleSteps((prev) => prev.filter((_, idx) => idx !== i));
  }
  function startSchedule() {
    setStep1Weeks("4");
    setScheduleSteps([{ id: uid(), amount: "", unit: isCapsule ? "capsule" : doseUnit, weeks: "" }]);
  }

  const previewSteps = scheduleSteps.length
    ? [
        {
          label: "Step 1",
          amount: doseAmount || 0,
          unit: doseUnit,
          weeks: parseFloat(step1Weeks) || 0,
          units: calc.conc > 0 ? (toMcg(parseFloat(doseAmount) || 0, doseUnit) / calc.conc) * 100 : 0,
        },
        ...scheduleSteps.map((s, i) => ({
          label: `Step ${i + 2}`,
          amount: s.amount || 0,
          unit: s.unit,
          weeks: i === scheduleSteps.length - 1 ? parseFloat(s.weeks) || Infinity : parseFloat(s.weeks) || 0,
          units: calc.conc > 0 ? (toMcg(parseFloat(s.amount) || 0, s.unit) / calc.conc) * 100 : 0,
        })),
      ]
    : [];

  return (
    <div className="space-y-5">
      <div className="flex rounded-lg overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
        {[
          { id: "vial", label: "Reconstitute" },
          { id: "premixed", label: "Premixed" },
          { id: "capsule", label: "Pills/Capsules" },
        ].map((opt) => (
          <button key={opt.id} onClick={() => selectType(opt.id)} className="flex-1 py-2 text-xs font-medium" style={{ background: itemType === opt.id ? INK : "white", color: itemType === opt.id ? "white" : INK }}>
            {opt.label}
          </button>
        ))}
      </div>

      <Field label={isCapsule ? "Product name (optional)" : "Peptide name (optional)"}>
        <input value={peptideName} onChange={(e) => setPeptideName(e.target.value)} placeholder={isCapsule ? "e.g. GHK-Cu capsules" : "e.g. BPC-157"} className="w-full" style={inputStyle} />
      </Field>

      {isCapsule ? (
        <Field label="Capsules per bottle">
          <input type="number" inputMode="numeric" value={vialAmount} onChange={(e) => setVialAmount(e.target.value)} placeholder="60" style={inputStyle} className="w-full font-mono" />
        </Field>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Field label={itemType === "premixed" ? "Concentration (per mL)" : "Vial amount"}>
              <div className="flex gap-2">
                <input type="number" inputMode="decimal" value={vialAmount} onChange={(e) => setVialAmount(e.target.value)} placeholder={itemType === "premixed" ? "200" : "5"} style={inputStyle} className="w-full font-mono" />
                <UnitToggle value={vialUnit} onChange={setVialUnit} options={["mg", "mcg"]} />
              </div>
            </Field>
            <Field label={itemType === "premixed" ? "Vial volume" : (solveMode === "units" ? "Desired draw (units)" : "BAC water")}>
              {itemType === "vial" && solveMode === "units" ? (
                <input type="number" inputMode="decimal" value={desiredUnits} onChange={(e) => setDesiredUnits(e.target.value)} placeholder="20" style={inputStyle} className="w-full font-mono" />
              ) : (
                <input type="number" inputMode="decimal" value={bacWater} onChange={(e) => setBacWater(e.target.value)} placeholder={itemType === "premixed" ? "10" : "2"} style={inputStyle} className="w-full font-mono" />
              )}
            </Field>
          </div>
          {itemType === "vial" && (
            <div className="flex items-center justify-between -mt-3">
              <p className="text-xs" style={{ color: "#8A9299" }}>
                {solveMode === "units" ? "Enter the syringe units you want to draw — we'll solve for the water" : "mL of bacteriostatic water added"}
              </p>
              <button
                onClick={() => setSolveMode(solveMode === "units" ? "water" : "units")}
                className="text-[11px] font-medium shrink-0 ml-2"
                style={{ color: TEAL }}
              >
                {solveMode === "units" ? "← Enter water directly" : "Solve for water instead →"}
              </button>
            </div>
          )}
          {itemType === "premixed" && (
            <p className="text-xs -mt-3" style={{ color: "#8A9299" }}>
              e.g. 200mg/mL in a 10mL vial — the amount per mL, then how many mL total
            </p>
          )}
        </>
      )}

      <div className="grid grid-cols-2 gap-3">
        <Field label={isCapsule ? "Capsules per dose" : (scheduleSteps.length ? "Starting dose (step 1)" : "Your target dose")}>
          {isCapsule ? (
            <input type="number" inputMode="numeric" value={doseAmount} onChange={(e) => setDoseAmount(e.target.value)} placeholder="2" style={inputStyle} className="w-full font-mono" />
          ) : (
            <div className="flex gap-2">
              <input type="number" inputMode="decimal" value={doseAmount} onChange={(e) => setDoseAmount(e.target.value)} placeholder="250" style={inputStyle} className="w-full font-mono" />
              <UnitToggle value={doseUnit} onChange={setDoseUnit} options={["mcg", "mg"]} />
            </div>
          )}
        </Field>
        <Field label="Doses / week">
          <input type="number" inputMode="decimal" value={freq} onChange={(e) => setFreq(e.target.value)} placeholder="7" style={inputStyle} className="w-full font-mono" />
        </Field>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Field label={`Cost per ${unitWord(itemType)} ($, optional)`}>
          <input type="number" inputMode="decimal" value={costPerVial} onChange={(e) => setCostPerVial(e.target.value)} placeholder="60" style={inputStyle} className="w-full font-mono" />
        </Field>
        <Field label={`${unitWord(itemType) === "bottle" ? "Bottles" : "Vials"} on hand`}>
          <input type="number" inputMode="numeric" min="1" value={vialsInStock} onChange={(e) => setVialsInStock(e.target.value)} placeholder="1" style={inputStyle} className="w-full font-mono" />
        </Field>
      </div>
      <p className="text-xs -mt-3" style={{ color: "#8A9299" }}>If you have more than one on hand, Flyptide rolls from one to the next automatically.</p>

      {/* ---- dose schedule / titration ---- */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="block text-xs font-medium" style={{ color: "#5B646C" }}>Dose schedule</label>
          {scheduleSteps.length === 0 && (
            <button onClick={startSchedule} className="text-[11px] font-medium flex items-center gap-1" style={{ color: TEAL }}>
              <CalendarClock size={12} /> Add a dose change
            </button>
          )}
        </div>

        {scheduleSteps.length > 0 && (
          <div className="space-y-2.5 rounded-xl p-3" style={{ background: "white", border: `1px solid ${LINE}` }}>
            <div className="flex items-center gap-2">
              <span className="text-[11px] w-14 shrink-0" style={{ color: "#8A9299" }}>Step 1</span>
              <span className="text-xs font-mono flex-1">{doseAmount || "—"}{isCapsule ? " caps" : doseUnit} for</span>
              <input type="number" inputMode="numeric" value={step1Weeks} onChange={(e) => setStep1Weeks(e.target.value)} placeholder="4" style={{ ...inputStyle, width: 52 }} className="font-mono text-center" />
              <span className="text-[11px]" style={{ color: "#8A9299" }}>wks</span>
              <span style={{ width: 14 }} />
            </div>

            {scheduleSteps.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <span className="text-[11px] w-14 shrink-0" style={{ color: "#8A9299" }}>Step {i + 2}</span>
                <input type="number" inputMode="decimal" value={s.amount} onChange={(e) => updateStep(i, { amount: e.target.value })} placeholder="2" style={{ ...inputStyle, width: 60 }} className="font-mono" />
                {!isCapsule && <UnitToggle value={s.unit} onChange={(u) => updateStep(i, { unit: u })} options={["mg", "mcg"]} />}
                <input
                  type="number"
                  inputMode="numeric"
                  value={s.weeks}
                  onChange={(e) => updateStep(i, { weeks: e.target.value })}
                  placeholder={i === scheduleSteps.length - 1 ? "ongoing" : "4"}
                  style={{ ...inputStyle, width: 60 }}
                  className="font-mono text-center"
                />
                <span className="text-[11px] shrink-0" style={{ color: "#8A9299" }}>wks</span>
                <button onClick={() => removeStep(i)} style={{ color: "#B7BEC4" }}><X size={14} /></button>
              </div>
            ))}

            <button onClick={addStep} className="text-[11px] font-medium flex items-center gap-1" style={{ color: TEAL }}>
              <Plus size={12} /> Add step
            </button>

            <div className="pt-2 mt-1 space-y-1" style={{ borderTop: `1px solid ${LINE}` }}>
              {previewSteps.map((p) => (
                <p key={p.label} className="text-[11px] font-mono" style={{ color: "#6B7680" }}>
                  {p.label}: {p.amount}{isCapsule ? " caps" : p.unit}
                  {!isCapsule && calc.conc > 0 && ` → ${fmt(p.units, 1)} units`}
                  {p.weeks === Infinity ? " (ongoing)" : ` for ${p.weeks} wks`}
                </p>
              ))}
            </div>
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed" style={{ color: "#8A9299" }}>
        This tool only does the arithmetic on the numbers you enter. It doesn't recommend peptides, supplements,
        doses, or protocols. Confirm your plan with a qualified healthcare provider.
      </p>

      {isCapsule ? (
        valid ? (
          <div className="rounded-2xl p-4 space-y-2" style={{ background: "white", border: `1px solid ${LINE}` }}>
            <Stat label="Doses per bottle" value={`${fmt(calc.totalDoses, 0)}`} big />
            <Stat label="Bottle lasts" value={`${fmt(calc.daysSupply, 0)} days`} />
            {calc.costPerDose > 0 && <Stat label="Cost / dose" value={`$${fmt(calc.costPerDose, 2)}`} />}
          </div>
        ) : (
          <div className="rounded-2xl p-6 text-center text-sm" style={{ background: "white", border: `1px dashed ${LINE}`, color: "#8A9299" }}>
            Fill in capsules per bottle and per dose to see your supply.
          </div>
        )
      ) : valid ? (
        <div className="rounded-2xl p-4 flex gap-4 items-center" style={{ background: "white", border: `1px solid ${LINE}` }}>
          <SyringeGauge units={calc.units} scale={scale} />
          <div className="flex-1 space-y-2">
            {solveMode === "units" ? (
              <>
                <Stat label="Water needed" value={`${fmt(calc.water, 2)} mL`} big />
                <Stat label="Concentration" value={fmtConc(calc.conc)} />
                <Stat label="Draw" value={`${fmt(calc.units, 1)} units`} />
              </>
            ) : (
              <>
                <Stat label="Concentration" value={fmtConc(calc.conc)} />
                <Stat label={scheduleSteps.length ? "Step 1 draw" : "Draw to"} value={`${fmt(calc.units, 1)} units`} big />
                <Stat label="Volume" value={`${fmt(calc.doseMl, 3)} mL`} />
              </>
            )}
            <Stat label="Vial lasts" value={`${fmt(calc.daysSupply, 0)} days`} />
            {calc.costPerDose > 0 && <Stat label="Cost / dose" value={`$${fmt(calc.costPerDose, 2)}`} />}
            {overfill && (
              <div className="flex items-start gap-1.5 mt-1 text-[11px] rounded-lg px-2 py-1.5" style={{ background: "#FBEEE3", color: AMBER }}>
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>This dose needs more than a 1 mL (100‑unit) syringe at this dilution — consider more liquid.</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="rounded-2xl p-6 text-center text-sm" style={{ background: "white", border: `1px dashed ${LINE}`, color: "#8A9299" }}>
          Fill in the amount, volume, and dose to see your draw.
        </div>
      )}

      {valid && (
        <button onClick={saveVial} className="w-full rounded-xl py-3 font-medium text-white flex items-center justify-center gap-2" style={{ background: TEAL }}>
          <Plus size={16} /> Save as tracked {unitWord(itemType)}
        </button>
      )}
    </div>
  );
}

function Stat({ label, value, big }) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-[11px]" style={{ color: "#8A9299" }}>{label}</span>
      <span className={`font-mono tabular-nums ${big ? "text-lg font-semibold" : "text-sm"}`} style={{ color: big ? TEAL : INK }}>{value}</span>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: "#5B646C" }}>{label}</label>
      {children}
    </div>
  );
}

const inputStyle = { background: "white", border: `1px solid ${LINE}`, borderRadius: "10px", padding: "9px 11px", fontSize: "14px", color: INK, outline: "none" };

function UnitToggle({ value, onChange, options }) {
  return (
    <div className="flex rounded-lg overflow-hidden shrink-0" style={{ border: `1px solid ${LINE}` }}>
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className="px-2.5 text-xs font-mono" style={{ background: value === o ? INK : "white", color: value === o ? "white" : INK }}>{o}</button>
      ))}
    </div>
  );
}

// ---------- Inventory tab ----------
function InventoryTab({ vials, vialStats, isPro, onAdd, onRemove, onLog, onToggleReminder, onStartNextVial, onRestock, onEdit, onChangeDose }) {
  if (!vials.length) {
    return <EmptyState icon={Package} title="Nothing tracked yet" body="Run a calculation and save it to start tracking supply and cost." action={{ label: "Go to calculator", onClick: onAdd }} />;
  }
  return (
    <div className="space-y-3">
      {vials.map((v) => {
        const s = vialStats(v);
        const type = s.type;
        const isCapsule = type === "capsule";
        const low = s.stockDaysLeft <= 5;
        const isBatch = s.vialsInStock > 1;
        const Icon = typeIcon(type);
        return (
          <div key={v.id} className="rounded-2xl p-4" style={{ background: "white", border: `1px solid ${LINE}` }}>
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Icon size={13} color="#8A9299" />
                  <h3 className="font-semibold text-sm">{v.name}</h3>
                  {isBatch && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full" style={{ background: "#F3F2EE", color: "#6B7680" }}>
                      {unitWord(type)} {s.vialsOpened} of {s.vialsInStock}
                    </span>
                  )}
                  {s.isTitrating && (
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full flex items-center gap-1" style={{ background: "#EAF2FD", color: "#2A6FB0" }}>
                      <CalendarClock size={9} /> week {s.weekNumber}
                    </span>
                  )}
                </div>
                <p className="text-[11px] mt-0.5" style={{ color: "#8A9299" }}>
                  {isCapsule
                    ? `${v.vialAmount} capsules per bottle`
                    : type === "premixed"
                    ? `${fmtConc(v.bacWater > 0 ? toMcg(v.vialAmount, v.vialUnit) / v.bacWater : 0)} in a ${v.bacWater}mL vial`
                    : `${v.vialAmount}${v.vialUnit} in ${v.bacWater}mL`}
                </p>
              </div>
              <button onClick={() => onRemove(v.id)} style={{ color: "#B7BEC4" }}><Trash2 size={16} /></button>
            </div>

            <div className="mt-3 h-1.5 rounded-full overflow-hidden" style={{ background: LINE }}>
              <div className="h-full rounded-full" style={{ width: `${Math.round(s.pct * 100)}%`, background: s.isEmpty ? "#B7BEC4" : (low ? AMBER : TEAL) }} />
            </div>

            <div className="rounded-lg px-2.5 py-2 mt-2.5 text-[11px]" style={{ background: "#F7F6F2" }}>
              <div className="flex items-center justify-between">
                <span className="font-medium">Now: {s.currentStep.amount}{isCapsule ? ` capsule${s.currentStep.amount === 1 ? "" : "s"}` : s.currentStep.unit}</span>
                {!isCapsule && <span className="font-mono" style={{ color: TEAL }}>draw {fmt(s.currentUnits, 1)}u</span>}
              </div>
              {s.changeDate && s.nextStep && (
                <div className="mt-0.5" style={{ color: "#6B7680" }}>
                  → {s.nextStep.amount}{isCapsule ? " capsules" : s.nextStep.unit} starting {s.changeDate.toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1.5">
              <button onClick={() => onChangeDose(v)} className="text-[11px] font-medium flex items-center gap-1" style={{ color: TEAL }}>
                <SlidersHorizontal size={11} /> Change dose
              </button>
              <button onClick={() => onEdit(v)} className="text-[11px] font-medium flex items-center gap-1" style={{ color: "#8A9299" }}>
                <Pencil size={11} /> Edit full schedule
              </button>
            </div>

            <div className="flex items-center justify-between mt-2 text-[11px]" style={{ color: "#6B7680" }}>
              <span>{fmt(s.remaining, 0)} doses left in this {unitWord(type)}</span>
              {s.costPerDose > 0 && <span className="flex items-center gap-1"><DollarSign size={11} />{fmt(s.costPerDose, 2)}/dose</span>}
            </div>

            {isBatch ? (
              <div className="flex items-center justify-between mt-1 text-[11px]" style={{ color: low ? AMBER : "#8A9299" }}>
                <span className="flex items-center gap-1">{low && <AlertTriangle size={12} />}Whole batch: {fmt(s.stockDaysLeft, 0)} days left</span>
                <span>{s.unopenedVials} unopened</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 mt-1 text-[11px]" style={{ color: low ? AMBER : "#6B7680" }}>
                {low && <AlertTriangle size={12} />}{fmt(s.stockDaysLeft, 0)} days left
              </div>
            )}

            {s.isEmpty ? (
              s.unopenedVials > 0 ? (
                <button onClick={() => onStartNextVial(v)} className="w-full mt-3 rounded-lg py-2 text-xs font-medium flex items-center justify-center gap-1.5" style={{ background: "#EFF6F5", color: TEAL }}>
                  <Icon size={13} /> Start {unitWord(type)} {s.vialsOpened + 1} of {s.vialsInStock}
                </button>
              ) : (
                <div className="flex gap-2 mt-3">
                  <div className="flex-1 rounded-lg py-2 text-xs font-medium flex items-center justify-center gap-1.5" style={{ background: "#FBEEE3", color: AMBER }}>
                    <AlertTriangle size={13} /> Out of stock
                  </div>
                  <button onClick={() => onRestock(v)} className="rounded-lg py-2 px-3 text-xs font-medium flex items-center justify-center gap-1.5" style={{ background: "#F3F2EE", color: INK }}>
                    <Plus size={13} /> Restock
                  </button>
                </div>
              )
            ) : (
              <div className="flex gap-2 mt-3">
                <button onClick={() => onLog(v)} className="flex-1 rounded-lg py-2 text-xs font-medium flex items-center justify-center gap-1.5" style={{ background: "#EFF6F5", color: TEAL }}>
                  <Check size={13} /> Log dose
                </button>
                <button
                  onClick={() => onToggleReminder(v)}
                  className="rounded-lg py-2 px-3 text-xs font-medium flex items-center justify-center gap-1.5"
                  style={{ background: v.remindersOn ? "#FBF0DD" : "#F3F2EE", color: v.remindersOn ? AMBER : "#8A9299" }}
                >
                  {isPro ? <Bell size={13} /> : <Lock size={12} />}
                  {isPro ? (v.remindersOn ? "On" : "Remind") : "Remind"}
                </button>
                <button onClick={() => onRestock(v)} className="rounded-lg py-2 px-3 text-xs font-medium flex items-center justify-center" style={{ background: "#F3F2EE", color: "#8A9299" }} title={`Add another ${unitWord(type)} to stock`}>
                  <Plus size={13} />
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------- Log tab ----------
function LogTab({ log, isPro, onExport }) {
  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold">History</h2>
        <button onClick={onExport} className="text-[11px] font-medium flex items-center gap-1 px-2.5 py-1.5 rounded-lg" style={{ background: "white", border: `1px solid ${LINE}`, color: isPro ? INK : "#8A9299" }}>
          {isPro ? <Download size={12} /> : <Lock size={11} />} Export CSV
        </button>
      </div>
      {!log.length ? (
        <EmptyState icon={Clock} title="No doses logged yet" body="Log a dose from your inventory to build your history and site rotation." />
      ) : (
        <div className="space-y-2">
          {log.map((entry) => (
            <div key={entry.id} className="rounded-xl p-3" style={{ background: "white", border: `1px solid ${LINE}` }}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">{entry.name}</p>
                  {entry.site && (
                    <p className="text-[11px] flex items-center gap-1 mt-0.5" style={{ color: "#8A9299" }}><MapPin size={11} /> {entry.site}</p>
                  )}
                </div>
                <div className="text-right">
                  <p className="text-xs font-mono">{entry.doseAmount}{entry.doseUnit === "capsule" ? " caps" : entry.doseUnit}</p>
                  <p className="text-[10px]" style={{ color: "#8A9299" }}>{new Date(entry.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
                </div>
              </div>
              {entry.notes && (
                <p className="text-[11px] mt-1.5 pt-1.5" style={{ color: "#6B7680", borderTop: `1px solid ${LINE}` }}>{entry.notes}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ icon: Icon, title, body, action }) {
  return (
    <div className="text-center py-14 px-4">
      <Icon size={28} className="mx-auto mb-3" color="#B7BEC4" />
      <h3 className="font-semibold text-sm">{title}</h3>
      <p className="text-xs mt-1 max-w-[220px] mx-auto" style={{ color: "#8A9299" }}>{body}</p>
      {action && (
        <button onClick={action.onClick} className="mt-4 text-xs font-medium px-4 py-2 rounded-lg inline-flex items-center gap-1" style={{ background: TEAL, color: "white" }}>
          {action.label} <ChevronRight size={13} />
        </button>
      )}
    </div>
  );
}

// ---------- Account tab ----------
function AccountTab({ isPro, cancelAtPeriodEnd, currentPeriodEnd, vials, vialStats, log, customSites, userEmail, syringePref, setSyringePref, onAddSite, onRemoveSite, onUpgrade, onDowngrade, onExport, onSignOut }) {
  const [siteInput, setSiteInput] = useState("");
  const [billingInterval, setBillingInterval] = useState("annual"); // default to the better deal

  const totals = useMemo(() => {
    let spent = 0;
    const perPeptide = vials.map((v) => {
      const s = vialStats(v);
      spent += s.spent;
      return { name: v.name, spent: s.spent };
    }).sort((a, b) => b.spent - a.spent);
    return { spent, perPeptide, doses: log.length };
  }, [vials, log, vialStats]);

  const maxSpend = Math.max(1, ...totals.perPeptide.map((p) => p.spent));

  function submitSite() {
    if (siteInput.trim()) { onAddSite(siteInput.trim()); setSiteInput(""); }
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-4" style={{ background: "white", border: `1px solid ${LINE}` }}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs" style={{ color: "#8A9299" }}>Current plan</p>
            <p className="font-semibold flex items-center gap-1.5 mt-0.5">{isPro && <Crown size={15} color={AMBER} />}{isPro ? "Pro" : "Free"}</p>
          </div>
          {isPro ? (
            <button onClick={onDowngrade} className="text-[11px] font-medium px-3 py-1.5 rounded-lg" style={{ border: `1px solid ${LINE}`, color: "#8A9299" }}>Manage billing</button>
          ) : (
            <button onClick={() => onUpgrade(billingInterval)} className="text-xs font-medium px-3 py-2 rounded-lg text-white" style={{ background: TEAL }}>
              Upgrade — {billingInterval === "annual" ? PRICE_ANNUAL : PRICE}
            </button>
          )}
        </div>
        {isPro && cancelAtPeriodEnd && (
          <div className="flex items-center gap-1.5 mt-3 text-[11px] rounded-lg px-2.5 py-2" style={{ background: "#FBEEE3", color: "#8A5A2B" }}>
            <AlertTriangle size={12} />
            Cancelled — you'll keep Pro through{" "}
            {currentPeriodEnd ? new Date(currentPeriodEnd).toLocaleDateString(undefined, { month: "long", day: "numeric" }) : "the end of this billing period"}, then it drops to Free.
          </div>
        )}
        {!isPro && (
          <div className="flex rounded-lg overflow-hidden mt-3" style={{ border: `1px solid ${LINE}` }}>
            <button onClick={() => setBillingInterval("monthly")} className="flex-1 py-1.5 text-xs font-medium" style={{ background: billingInterval === "monthly" ? INK : "white", color: billingInterval === "monthly" ? "white" : INK }}>
              Monthly — {PRICE}
            </button>
            <button onClick={() => setBillingInterval("annual")} className="flex-1 py-1.5 text-xs font-medium flex items-center justify-center gap-1" style={{ background: billingInterval === "annual" ? INK : "white", color: billingInterval === "annual" ? "white" : INK }}>
              Annual — {PRICE_ANNUAL} <span style={{ color: billingInterval === "annual" ? AMBER : "#8A9299" }}>· save 33%</span>
            </button>
          </div>
        )}
      </div>

      <div className="rounded-2xl p-4 space-y-2.5" style={{ background: "white", border: `1px solid ${LINE}` }}>
        <p className="text-xs font-semibold mb-1">What's included</p>
        <FeatureRow label="Reconstitution / premixed / capsule tracking" included />
        <FeatureRow label="Dose schedules / titration" included />
        <FeatureRow label="1 tracked item" included free />
        <FeatureRow label="Unlimited tracked items" included={isPro} />
        <FeatureRow label="Dose reminders" included={isPro} />
        <FeatureRow label="CSV export of history" included={isPro} />
        <FeatureRow label="Spend insights" included={isPro} />
      </div>

      <div className="rounded-2xl p-4" style={{ background: "white", border: `1px solid ${LINE}` }}>
        <p className="text-xs font-semibold mb-2">Preferred syringe size</p>
        <p className="text-[11px] mb-2.5" style={{ color: "#8A9299" }}>
          The gauge shows this size whenever your dose fits in it. If a dose is too big for your
          chosen size, it automatically shows the next size up that actually fits.
        </p>
        <div className="grid grid-cols-4 gap-1.5">
          {[
            { id: "auto", label: "Auto" },
            { id: "30", label: "0.3mL" },
            { id: "50", label: "0.5mL" },
            { id: "100", label: "1mL" },
          ].map((opt) => (
            <button
              key={opt.id}
              onClick={() => setSyringePref(opt.id)}
              className="rounded-lg py-2 text-[11px] font-medium"
              style={{
                background: syringePref === opt.id ? TEAL : "#F3F2EE",
                color: syringePref === opt.id ? "white" : INK,
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl p-4" style={{ background: "white", border: `1px solid ${LINE}` }}>
        <p className="text-xs font-semibold mb-2">Injection sites</p>
        <p className="text-[11px] mb-2" style={{ color: "#8A9299" }}>{DEFAULT_SITES.length} standard sites are always available, plus any custom ones below.</p>
        {customSites.length > 0 && (
          <div className="space-y-1.5 mb-2">
            {customSites.map((s) => (
              <div key={s} className="flex items-center justify-between text-xs">
                <span>{s}</span>
                <button onClick={() => onRemoveSite(s)} style={{ color: "#B7BEC4" }}><X size={13} /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input value={siteInput} onChange={(e) => setSiteInput(e.target.value)} placeholder="Add custom site" style={inputStyle} className="flex-1 text-xs" />
          <button onClick={submitSite} className="rounded-lg px-3 text-xs font-medium" style={{ background: TEAL, color: "white" }}>Add</button>
        </div>
      </div>

      <div className="rounded-2xl p-4" style={{ background: "white", border: `1px solid ${LINE}` }}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-xs font-semibold flex items-center gap-1.5"><TrendingUp size={14} color={TEAL} /> Spend insights</p>
          {isPro && (
            <button onClick={onExport} className="text-[11px] font-medium flex items-center gap-1" style={{ color: TEAL }}><Download size={11} /> Export</button>
          )}
        </div>

        {isPro ? (
          totals.perPeptide.length ? (
            <div className="space-y-2">
              <Stat label="Total spent so far" value={`$${fmt(totals.spent, 2)}`} big />
              <Stat label="Doses logged" value={`${totals.doses}`} />
              <div className="pt-2 space-y-1.5">
                {totals.perPeptide.map((p) => (
                  <div key={p.name}>
                    <div className="flex justify-between text-[11px] mb-0.5"><span>{p.name}</span><span className="font-mono">${fmt(p.spent, 2)}</span></div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: LINE }}>
                      <div className="h-full rounded-full" style={{ width: `${(p.spent / maxSpend) * 100}%`, background: TEAL }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-xs" style={{ color: "#8A9299" }}>Log a few doses to see spend trends here.</p>
          )
        ) : (
          <div className="relative">
            <div className="space-y-2 blur-sm select-none pointer-events-none">
              <Stat label="Total spent so far" value="$142.50" big />
              <Stat label="Doses logged" value="24" />
            </div>
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
              <Lock size={16} color="#8A9299" />
              <button onClick={onUpgrade} className="text-[11px] font-medium px-3 py-1.5 rounded-lg text-white" style={{ background: TEAL }}>Unlock with Pro</button>
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl p-4 flex items-center justify-between" style={{ background: "white", border: `1px solid ${LINE}` }}>
        <div>
          <p className="text-xs" style={{ color: "#8A9299" }}>Signed in as</p>
          <p className="text-sm font-medium mt-0.5">{userEmail}</p>
        </div>
        <button onClick={onSignOut} className="text-[11px] font-medium flex items-center gap-1 px-3 py-1.5 rounded-lg" style={{ border: `1px solid ${LINE}`, color: "#8A9299" }}>
          <LogOut size={12} /> Sign out
        </button>
      </div>
    </div>
  );
}

function FeatureRow({ label, included, free }) {
  return (
    <div className="flex items-center justify-between text-[12px]">
      <span style={{ color: included ? INK : "#B7BEC4" }}>{label}</span>
      {included ? <Check size={14} color={TEAL} /> : free ? null : <Lock size={12} color="#B7BEC4" />}
    </div>
  );
}

// ---------- Log modal ----------
function LogModal({ vial, stats, sites, suggested, syringePref, onClose, onConfirm, onAddSite }) {
  const isCapsule = stats.type === "capsule";
  const [site, setSite] = useState(suggested);
  const [newSite, setNewSite] = useState("");
  const [showMore, setShowMore] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const [whenDate, setWhenDate] = useState(today);
  const [notes, setNotes] = useState("");
  const scale = resolveScale(stats.currentUnits || 0, syringePref);
  const minDate = vial.createdAt ? new Date(vial.createdAt).toISOString().slice(0, 10) : undefined;
  const isBackdated = whenDate !== today;

  function addSite() {
    if (newSite.trim()) { onAddSite(newSite.trim()); setSite(newSite.trim()); setNewSite(""); }
  }

  function confirm() {
    const whenIso = isBackdated ? `${whenDate}T12:00:00` : null;
    onConfirm(isCapsule ? null : site, whenIso, notes.trim());
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(28,43,51,0.4)" }}>
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto" style={{ background: PAPER }}>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold text-sm">Log dose — {vial.name}</h3>
          <button onClick={onClose}><X size={18} color="#8A9299" /></button>
        </div>

        {isCapsule ? (
          <div className="rounded-2xl p-4 mb-4" style={{ background: "white", border: `1px solid ${LINE}` }}>
            {stats.isTitrating && (
              <p className="text-[10px] font-mono px-1.5 py-0.5 rounded-full inline-block mb-2" style={{ background: "#EAF2FD", color: "#2A6FB0" }}>week {stats.weekNumber}</p>
            )}
            <Stat label="Take" value={`${stats.currentStep.amount} capsule${stats.currentStep.amount === 1 ? "" : "s"}`} big />
          </div>
        ) : (
          <>
            <div className="rounded-2xl p-3 flex gap-4 items-center mb-4" style={{ background: "white", border: `1px solid ${LINE}` }}>
              <SyringeGauge units={stats.currentUnits} scale={scale} />
              <div className="flex-1 space-y-1.5">
                {stats.isTitrating && (
                  <p className="text-[10px] font-mono px-1.5 py-0.5 rounded-full inline-block" style={{ background: "#EAF2FD", color: "#2A6FB0" }}>week {stats.weekNumber}</p>
                )}
                <Stat label="Today's dose" value={`${stats.currentStep.amount}${stats.currentStep.unit}`} />
                <Stat label="Draw to" value={`${fmt(stats.currentUnits, 1)} units`} big />
                <Stat label="Volume" value={`${fmt(stats.currentDoseMl, 3)} mL`} />
              </div>
            </div>

            <p className="text-[11px] mb-3" style={{ color: "#8A9299" }}>Suggested site rotates automatically from your last injection.</p>
            <div className="grid grid-cols-2 gap-2">
              {sites.map((s) => (
                <button key={s} onClick={() => setSite(s)} className="rounded-lg py-2 text-xs font-medium flex items-center justify-center gap-1" style={{ background: site === s ? TEAL : "white", color: site === s ? "white" : INK, border: `1px solid ${site === s ? TEAL : LINE}` }}>
                  {s === suggested && <span style={{ opacity: site === s ? 1 : 0.5 }}>★</span>}{s}
                </button>
              ))}
            </div>
            <div className="flex gap-2 mt-2">
              <input value={newSite} onChange={(e) => setNewSite(e.target.value)} placeholder="Add custom site" style={inputStyle} className="flex-1 text-xs" />
              <button onClick={addSite} className="rounded-lg px-3 text-xs font-medium" style={{ background: "#F3F2EE", color: INK }}>Add</button>
            </div>
          </>
        )}

        <button onClick={() => setShowMore(!showMore)} className="text-[11px] font-medium mt-3 flex items-center gap-1" style={{ color: TEAL }}>
          <CalendarClock size={11} /> {showMore ? "Hide date & notes" : "Log for a different date, add notes"}
        </button>
        {showMore && (
          <div className="mt-2 space-y-2.5">
            <Field label="Date">
              <input type="date" value={whenDate} min={minDate} max={today} onChange={(e) => setWhenDate(e.target.value)} style={inputStyle} className="w-full" />
            </Field>
            <Field label="Notes (optional)">
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. mild redness at site" style={inputStyle} className="w-full text-sm" />
            </Field>
          </div>
        )}

        <button onClick={confirm} className="w-full mt-4 rounded-xl py-3 font-medium text-white" style={{ background: INK }}>
          {isCapsule ? "Confirm taken" : "Confirm dose logged"}
        </button>
      </div>
    </div>
  );
}

// ---------- Change dose modal (effective today, up or down) ----------
function ChangeDoseModal({ vial, stats, syringePref, onClose, onSave }) {
  const isCapsule = stats.type === "capsule";
  const [amount, setAmount] = useState("");
  const [unit, setUnit] = useState(vial.doseUnit);
  const doseMcg = toMcg(parseFloat(amount) || 0, unit);
  const doseMl = stats.conc > 0 ? doseMcg / stats.conc : 0;
  const units = doseMl * 100;
  const valid = isCapsule ? parseFloat(amount) > 0 : parseFloat(amount) > 0 && stats.conc > 0;
  const scale = resolveScale(units || 0, syringePref);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(28,43,51,0.4)" }}>
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5" style={{ background: PAPER }}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-sm">Change dose — {vial.name}</h3>
          <button onClick={onClose}><X size={18} color="#8A9299" /></button>
        </div>
        <p className="text-[11px] mb-4" style={{ color: "#8A9299" }}>
          Currently {stats.currentStep.amount}{isCapsule ? " capsules" : stats.currentStep.unit}. Setting a new amount
          takes effect from today — up or down — without touching doses you've already logged.
        </p>

        <Field label={isCapsule ? "New dose (capsules)" : "New dose"}>
          <div className="flex gap-2">
            <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1.5" style={inputStyle} className="w-full font-mono" autoFocus />
            {!isCapsule && <UnitToggle value={unit} onChange={setUnit} options={["mg", "mcg"]} />}
          </div>
        </Field>

        {valid && !isCapsule && (
          <div className="rounded-2xl p-4 flex gap-4 items-center mt-4" style={{ background: "white", border: `1px solid ${LINE}` }}>
            <SyringeGauge units={units} scale={scale} />
            <div className="flex-1 space-y-2">
              <Stat label="New draw" value={`${fmt(units, 1)} units`} big />
              <Stat label="Volume" value={`${fmt(doseMl, 3)} mL`} />
            </div>
          </div>
        )}

        <button
          onClick={() => valid && onSave(parseFloat(amount), isCapsule ? "capsule" : unit)}
          disabled={!valid}
          className="w-full mt-4 rounded-xl py-3 font-medium text-white"
          style={{ background: valid ? TEAL : "#C9CDD1" }}
        >
          Set new dose from today
        </button>
      </div>
    </div>
  );
}

// ---------- Edit schedule modal ----------
function EditScheduleModal({ vial, onClose, onSave }) {
  const isCapsule = getType(vial) === "capsule";
  const [amount, setAmount] = useState(String(vial.doseAmount));
  const [unit, setUnit] = useState(vial.doseUnit);
  const [step1Weeks, setStep1Weeks] = useState(vial.step1Weeks || "");
  const [steps, setSteps] = useState((vial.titration || []).map((s) => ({ ...s, id: s.id || uid() })));

  const conc = vial.bacWater > 0 ? toMcg(vial.vialAmount, vial.vialUnit) / vial.bacWater : 0;
  const elapsedDays = Math.floor((Date.now() - new Date(vial.createdAt).getTime()) / (24 * 3600 * 1000));

  function addStep() { setSteps((prev) => [...prev, { id: uid(), amount: "", unit: isCapsule ? "capsule" : unit, weeks: "" }]); }
  function updateStep(i, patch) { setSteps((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s))); }
  function removeStep(i) { setSteps((prev) => prev.filter((_, idx) => idx !== i)); }
  function startSchedule() { setStep1Weeks("4"); setSteps([{ id: uid(), amount: "", unit: isCapsule ? "capsule" : unit, weeks: "" }]); }

  const previewSteps = steps.length
    ? [
        { label: "Step 1", amount: amount || 0, unit, weeks: parseFloat(step1Weeks) || 0, units: conc > 0 ? (toMcg(parseFloat(amount) || 0, unit) / conc) * 100 : 0 },
        ...steps.map((s, i) => ({
          label: `Step ${i + 2}`,
          amount: s.amount || 0,
          unit: s.unit,
          weeks: i === steps.length - 1 ? parseFloat(s.weeks) || Infinity : parseFloat(s.weeks) || 0,
          units: conc > 0 ? (toMcg(parseFloat(s.amount) || 0, s.unit) / conc) * 100 : 0,
        })),
      ]
    : [];

  function save() {
    onSave({
      doseAmount: parseFloat(amount) || 0,
      doseUnit: unit,
      step1Weeks: steps.length ? step1Weeks : "",
      titration: steps.map((s) => ({ amount: s.amount, unit: s.unit, weeks: s.weeks })),
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(28,43,51,0.4)" }}>
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-5 max-h-[90vh] overflow-y-auto" style={{ background: PAPER }}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-sm">Edit schedule — {vial.name}</h3>
          <button onClick={onClose}><X size={18} color="#8A9299" /></button>
        </div>
        <p className="text-[11px] mb-4" style={{ color: "#8A9299" }}>
          Started {new Date(vial.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })} · day {elapsedDays}.
          Past doses already logged won't change — this only affects doses from here forward.
        </p>

        <div className="space-y-2.5 rounded-xl p-3" style={{ background: "white", border: `1px solid ${LINE}` }}>
          <div className="flex items-center gap-2">
            <span className="text-[11px] w-14 shrink-0" style={{ color: "#8A9299" }}>Step 1</span>
            <input type="number" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} style={{ ...inputStyle, width: 60 }} className="font-mono" />
            {!isCapsule && <UnitToggle value={unit} onChange={setUnit} options={["mg", "mcg"]} />}
            {steps.length > 0 && (
              <>
                <span className="text-[11px]" style={{ color: "#8A9299" }}>for</span>
                <input type="number" inputMode="numeric" value={step1Weeks} onChange={(e) => setStep1Weeks(e.target.value)} placeholder="4" style={{ ...inputStyle, width: 52 }} className="font-mono text-center" />
                <span className="text-[11px]" style={{ color: "#8A9299" }}>wks</span>
              </>
            )}
          </div>

          {steps.map((s, i) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="text-[11px] w-14 shrink-0" style={{ color: "#8A9299" }}>Step {i + 2}</span>
              <input type="number" inputMode="decimal" value={s.amount} onChange={(e) => updateStep(i, { amount: e.target.value })} placeholder="2" style={{ ...inputStyle, width: 60 }} className="font-mono" />
              {!isCapsule && <UnitToggle value={s.unit} onChange={(u) => updateStep(i, { unit: u })} options={["mg", "mcg"]} />}
              <input
                type="number"
                inputMode="numeric"
                value={s.weeks}
                onChange={(e) => updateStep(i, { weeks: e.target.value })}
                placeholder={i === steps.length - 1 ? "ongoing" : "4"}
                style={{ ...inputStyle, width: 60 }}
                className="font-mono text-center"
              />
              <span className="text-[11px] shrink-0" style={{ color: "#8A9299" }}>wks</span>
              <button onClick={() => removeStep(i)} style={{ color: "#B7BEC4" }}><X size={14} /></button>
            </div>
          ))}

          {steps.length === 0 ? (
            <button onClick={startSchedule} className="text-[11px] font-medium flex items-center gap-1" style={{ color: TEAL }}>
              <CalendarClock size={12} /> Add a dose change
            </button>
          ) : (
            <button onClick={addStep} className="text-[11px] font-medium flex items-center gap-1" style={{ color: TEAL }}>
              <Plus size={12} /> Add step
            </button>
          )}

          {steps.length > 0 && (
            <div className="pt-2 mt-1 space-y-1" style={{ borderTop: `1px solid ${LINE}` }}>
              {previewSteps.map((p) => (
                <p key={p.label} className="text-[11px] font-mono" style={{ color: "#6B7680" }}>
                  {p.label}: {p.amount}{isCapsule ? " caps" : p.unit}
                  {!isCapsule && conc > 0 && ` → ${fmt(p.units, 1)} units`}
                  {p.weeks === Infinity ? " (ongoing)" : ` for ${p.weeks} wks`}
                </p>
              ))}
            </div>
          )}
        </div>

        <button onClick={save} className="w-full mt-4 rounded-xl py-3 font-medium text-white" style={{ background: TEAL }}>Save changes</button>
      </div>
    </div>
  );
}

// ---------- Paywall modal ----------
const PAYWALL_COPY = {
  vials: {
    title: "Track more than one item",
    body: "Free tracks 1 item at a time. Upgrade to track your whole stack — unlimited vials and bottles, all with their own supply and cost tracking.",
  },
  reminders: {
    title: "Never miss a dose",
    body: "Pro unlocks dose reminders per item, so you get nudged when it's time to take or inject.",
  },
  export: {
    title: "Export your history",
    body: "Pro lets you export your full dose log as a CSV — handy for sharing with a coach or provider.",
  },
};

function PaywallModal({ feature, onClose, onUpgrade }) {
  const copy = PAYWALL_COPY[feature] || PAYWALL_COPY.vials;
  const [billingInterval, setBillingInterval] = useState("annual");
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center" style={{ background: "rgba(28,43,51,0.4)" }}>
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-2xl p-6 text-center" style={{ background: PAPER }}>
        <button onClick={onClose} className="float-right"><X size={18} color="#8A9299" /></button>
        <Crown size={26} color={AMBER} className="mx-auto mb-3" />
        <h3 className="font-semibold text-base">{copy.title}</h3>
        <p className="text-xs mt-2 mb-5" style={{ color: "#8A9299" }}>{copy.body}</p>
        <ul className="text-left text-[12px] space-y-1.5 mb-5 inline-block">
          <li className="flex items-center gap-2"><Check size={13} color={TEAL} /> Unlimited tracked items</li>
          <li className="flex items-center gap-2"><Check size={13} color={TEAL} /> Dose reminders</li>
          <li className="flex items-center gap-2"><Check size={13} color={TEAL} /> CSV export</li>
          <li className="flex items-center gap-2"><Check size={13} color={TEAL} /> Spend insights</li>
        </ul>
        <div className="flex rounded-lg overflow-hidden mb-3" style={{ border: `1px solid ${LINE}` }}>
          <button onClick={() => setBillingInterval("monthly")} className="flex-1 py-1.5 text-xs font-medium" style={{ background: billingInterval === "monthly" ? INK : "white", color: billingInterval === "monthly" ? "white" : INK }}>
            Monthly — {PRICE}
          </button>
          <button onClick={() => setBillingInterval("annual")} className="flex-1 py-1.5 text-xs font-medium flex items-center justify-center gap-1" style={{ background: billingInterval === "annual" ? INK : "white", color: billingInterval === "annual" ? "white" : INK }}>
            Annual — {PRICE_ANNUAL} <span style={{ color: billingInterval === "annual" ? AMBER : "#8A9299" }}>· save 33%</span>
          </button>
        </div>
        <button onClick={() => onUpgrade(billingInterval)} className="w-full rounded-xl py-3 font-medium text-white" style={{ background: TEAL }}>
          Upgrade — {billingInterval === "annual" ? PRICE_ANNUAL : PRICE}
        </button>
        <p className="text-[10px] mt-3" style={{ color: "#B7BEC4" }}>Cancel anytime from Account settings.</p>
      </div>
    </div>
  );
}
