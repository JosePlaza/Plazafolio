// Supabase Edge Function: update-analyses
// Runs daily via cron to refresh analysis data for all users' assets.
//
// Required env vars (set in Supabase Dashboard > Edge Functions > Secrets):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, FMP_API_KEY
//
// Deploy:  supabase functions deploy update-analyses --no-verify-jwt
// Test:    supabase functions invoke update-analyses

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const fmpApiKey = Deno.env.get("FMP_API_KEY")!;

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 1. Get all unique tickers across all users
  const { data: assets, error: assetsErr } = await supabase
    .from("assets")
    .select("ticker, user_id");

  if (assetsErr) {
    return new Response(JSON.stringify({ error: assetsErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Group: { ticker: [user_ids] }
  const tickerUsers: Record<string, Set<string>> = {};
  for (const a of assets || []) {
    if (!tickerUsers[a.ticker]) tickerUsers[a.ticker] = new Set();
    tickerUsers[a.ticker].add(a.user_id);
  }

  const tickers = Object.keys(tickerUsers);
  const today = new Date().toISOString().split("T")[0];
  const results: Record<string, string> = {};

  for (const ticker of tickers) {
    try {
      // Fetch profile from FMP
      let profile = null;
      if (fmpApiKey) {
        try {
          const profileRes = await fetch(
            `https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(ticker)}&apikey=${fmpApiKey}`
          );
          if (profileRes.ok) {
            const profileData = await profileRes.json();
            if (Array.isArray(profileData) && profileData.length > 0) {
              const p = profileData[0];
              profile = {
                companyName: p.companyName,
                symbol: p.symbol,
                price: p.price,
                currency: p.currency,
                image: p.image,
                lastDividend: p.lastDividend,
              };
            }
          }
        } catch { /* skip profile */ }
      }

      // Update analyses for all users who have this ticker
      // We only update profile and last_updated date.
      // Indicators/projection/dividends are computed client-side from live API data.
      for (const userId of tickerUsers[ticker]) {
        await supabase.from("analyses").upsert(
          {
            user_id: userId,
            ticker,
            last_updated: today,
            profile: profile,
          },
          { onConflict: "user_id,ticker" }
        );
      }

      // Also update the asset's price if we got a profile
      if (profile?.price) {
        for (const userId of tickerUsers[ticker]) {
          await supabase
            .from("assets")
            .update({ price: profile.price })
            .eq("user_id", userId)
            .eq("ticker", ticker);
        }
      }

      results[ticker] = "ok";
    } catch (err) {
      results[ticker] = `error: ${(err as Error).message}`;
    }
  }

  return new Response(
    JSON.stringify({ updated: tickers.length, date: today, results }),
    {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
});
