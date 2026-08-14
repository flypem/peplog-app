import React, { useState } from "react";
import { supabase } from "./lib/supabaseClient";
import { FlaskConical, Mail } from "lucide-react";

export default function Auth() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendLink(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.origin },
    });
    setLoading(false);
    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ background: "#FAFAF8" }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2 mb-6 justify-center">
          <FlaskConical size={24} color="#127D77" />
          <h1 className="text-xl font-semibold" style={{ color: "#1C2B33" }}>Flyptide</h1>
        </div>

        {sent ? (
          <div className="text-center text-sm" style={{ color: "#6B7680" }}>
            <Mail size={28} className="mx-auto mb-3" color="#127D77" />
            Check <strong>{email}</strong> for a sign-in link.
          </div>
        ) : (
          <form onSubmit={sendLink} className="space-y-3">
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full px-3 py-3 rounded-xl text-sm"
              style={{ border: "1px solid #DEDBD2", outline: "none" }}
            />
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-medium text-white text-sm"
              style={{ background: "#127D77" }}
            >
              {loading ? "Sending…" : "Send sign-in link"}
            </button>
            {error && <p className="text-xs text-center" style={{ color: "#B54444" }}>{error}</p>}
            <p className="text-[11px] text-center" style={{ color: "#8A9299" }}>
              No password needed — we'll email you a one-time link.
            </p>
            <p className="text-[10px] text-center" style={{ color: "#B7BEC4" }}>
              By continuing you agree to our{" "}
              <a href="/terms" className="underline">Terms</a> and{" "}
              <a href="/privacy" className="underline">Privacy Policy</a>.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
