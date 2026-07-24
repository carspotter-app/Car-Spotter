"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "../lib/supabaseClient";

function fmtMoney(n) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
}

function resizeImageFile(file, maxWidth = 640, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Could not load image"));
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width);
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", quality);
        resolve({ dataUrl, base64: dataUrl.split(",")[1], mediaType: "image/jpeg" });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// Running on a real website (not a sandboxed artifact), so this direct fetch
// to Wikipedia's API works with no CORS/CSP restrictions.
async function fetchReferencePhoto(make, model, year) {
  const query = `${year || ""} ${make} ${model} car`.trim();
  try {
    const res = await fetch(
      `https://en.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(
        query
      )}&gsrlimit=1&prop=pageimages&piprop=original&format=json&origin=*`
    );
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages) return null;
    const page = Object.values(pages)[0];
    return page?.original?.source || null;
  } catch (e) {
    return null;
  }
}

export default function Home() {
  const [session, setSession] = useState(undefined); // undefined = loading, null = logged out
  const [authMode, setAuthMode] = useState("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authLoading, setAuthLoading] = useState(false);

  const [tab, setTab] = useState("scan");
  const [collection, setCollection] = useState([]);

  const [scanState, setScanState] = useState("idle");
  const [imagePreview, setImagePreview] = useState(null);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState("");

  const [vin, setVin] = useState("");
  const [vinStatus, setVinStatus] = useState("idle");
  const [vinData, setVinData] = useState(null);

  const [referencePhoto, setReferencePhoto] = useState(null);
  const [referenceStatus, setReferenceStatus] = useState("idle");

  const fileInputRef = useRef(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  const loadCollection = useCallback(async () => {
    const { data, error } = await supabase.from("cars").select("*").order("spotted_at", { ascending: false });
    if (!error) setCollection(data || []);
  }, []);

  useEffect(() => {
    if (session) loadCollection();
  }, [session, loadCollection]);

  async function handleAuth(e) {
    e.preventDefault();
    setAuthError("");
    setAuthNotice("");
    setAuthLoading(true);
    const fn = authMode === "signin" ? supabase.auth.signInWithPassword : supabase.auth.signUp;
    const { data, error } = await fn({ email: authEmail, password: authPassword });
    setAuthLoading(false);
    if (error) {
      setAuthError(error.message);
    } else if (authMode === "signup" && !data.session) {
      setAuthNotice("Check your email for a confirmation link, then come back and sign in.");
    }
  }

  async function handleFileSelected(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg("");
    setVin("");
    setVinStatus("idle");
    setVinData(null);
    setReferencePhoto(null);
    setReferenceStatus("idle");
    try {
      const { dataUrl, base64, mediaType } = await resizeImageFile(file);
      setImagePreview(dataUrl);
      analyzeImage(base64, mediaType);
    } catch (err) {
      setScanState("error");
      setErrorMsg("Couldn't read that photo. Try another one.");
    }
    e.target.value = "";
  }

  async function analyzeImage(base64, mediaType) {
    setScanState("analyzing");
    setResult(null);
    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64, mediaType }),
      });
      const parsed = await res.json();
      if (parsed.error) {
        setScanState("error");
        setErrorMsg(
          parsed.error === "no car detected"
            ? "Couldn't spot a car in that photo — try getting closer or reducing glare."
            : parsed.error
        );
        return;
      }
      setResult(parsed);
      setScanState("result");
      setReferenceStatus("loading");
      const url = await fetchReferencePhoto(parsed.make, parsed.model, parsed.yearEstimate);
      if (url) {
        setReferencePhoto(url);
        setReferenceStatus("done");
      } else {
        setReferenceStatus("none");
      }
    } catch (err) {
      setScanState("error");
      setErrorMsg("Something went wrong analyzing that photo. Try again.");
    }
  }

  async function handleVinLookup() {
    const cleanVin = vin.trim().toUpperCase();
    if (cleanVin.length !== 17) {
      setVinStatus("error");
      return;
    }
    setVinStatus("loading");
    try {
      const res = await fetch(`https://vpic.nhtsa.dot.gov/api/vehicles/decodevin/${cleanVin}?format=json`);
      const data = await res.json();
      const map = {};
      (data.Results || []).forEach((r) => {
        if (r.Value && r.Value !== "Not Applicable" && r.Value !== "") map[r.Variable] = r.Value;
      });
      if (!map["Make"]) {
        setVinStatus("error");
        return;
      }
      setVinData(map);
      setVinStatus("verified");
      const url = await fetchReferencePhoto(map["Make"], map["Model"], map["Model Year"]);
      if (url) {
        setReferencePhoto(url);
        setReferenceStatus("done");
      }
    } catch (e) {
      setVinStatus("error");
    }
  }

  function resetScan() {
    setScanState("idle");
    setImagePreview(null);
    setResult(null);
    setErrorMsg("");
    setVin("");
    setVinStatus("idle");
    setVinData(null);
    setReferencePhoto(null);
    setReferenceStatus("idle");
  }

  async function saveCar() {
    if (!result) return;
    const { data: userData } = await supabase.auth.getUser();
    const row = {
      user_id: userData.user.id,
      make: vinData?.Make || result.make,
      model: vinData?.Model || result.model,
      year: vinData?.["Model Year"] || result.yearEstimate,
      body_style: vinData?.["Body Class"] || result.bodyStyle,
      color: result.color,
      rarity_tier: result.rarityTier,
      value: result.estimatedValue,
      fun_fact: result.funFact,
      photo_url: referencePhoto || imagePreview,
      spotted_photo_url: imagePreview,
      verified: !!vinData,
      vin: vinData ? vin.trim().toUpperCase() : null,
    };
    const { error } = await supabase.from("cars").insert(row);
    if (!error) {
      await loadCollection();
      resetScan();
      setTab("collection");
    } else {
      setErrorMsg(error.message);
    }
  }

  async function deleteCar(id) {
    await supabase.from("cars").delete().eq("id", id);
    setCollection((prev) => prev.filter((c) => c.id !== id));
  }

  if (session === undefined) {
    return <div className="container"><p className="eyebrow">LOADING…</p></div>;
  }

  if (!session) {
    return (
      <div className="container" style={{ paddingTop: 80 }}>
        <p className="eyebrow" style={{ marginBottom: 6 }}>VEHICLE LOG</p>
        <h1 className="plate" style={{ fontSize: 30, textTransform: "uppercase", margin: "0 0 24px" }}>Spotter</h1>
        <form onSubmit={handleAuth} className="panel" style={{ padding: 20, display: "flex", flexDirection: "column", gap: 12 }}>
          <input type="email" placeholder="Email" required value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
          <input type="password" placeholder="Password" required minLength={6} value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
          {authError && <p style={{ color: "#F19A9A", fontSize: 13 }}>{authError}</p>}
          {authNotice && <p style={{ color: "#7DD3C8", fontSize: 13 }}>{authNotice}</p>}
          <button className="btn btn-primary" disabled={authLoading}>
            {authLoading ? "…" : authMode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>
        <button
          className="btn btn-secondary"
          style={{ marginTop: 12, width: "100%" }}
          onClick={() => { setAuthMode(authMode === "signin" ? "signup" : "signin"); setAuthError(""); }}
        >
          {authMode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}
        </button>
      </div>
    );
  }

  const totalValue = collection.reduce((sum, c) => sum + (Number(c.value) || 0), 0);

  return (
    <div className="container">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20 }}>
        <div>
          <p className="eyebrow" style={{ marginBottom: 4 }}>VEHICLE LOG</p>
          <h1 className="plate" style={{ fontSize: 26, textTransform: "uppercase", margin: 0 }}>Spotter</h1>
        </div>
        <button className="btn btn-secondary" style={{ padding: "8px 14px", fontSize: 13 }} onClick={() => supabase.auth.signOut()}>
          Sign out
        </button>
      </div>

      {tab === "scan" && (
        <div>
          {scanState === "idle" && (
            <div style={{ textAlign: "center", marginTop: 40 }}>
              <h2 className="plate" style={{ fontSize: 20, textTransform: "uppercase" }}>Spot a car</h2>
              <p style={{ color: "#71717A", fontSize: 14, maxWidth: 280, margin: "4px auto 24px" }}>
                Snap a photo and I'll identify the make, model, and estimated value.
              </p>
              <button className="btn btn-primary" onClick={() => fileInputRef.current?.click()}>
                Open camera
              </button>
              <input ref={fileInputRef} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={handleFileSelected} />
            </div>
          )}

          {scanState === "analyzing" && (
            <div style={{ textAlign: "center", marginTop: 40 }}>
              <div className="panel" style={{ position: "relative", aspectRatio: "4/3", overflow: "hidden", maxWidth: 360, margin: "0 auto" }}>
                {imagePreview && <img src={imagePreview} alt="Scanning" style={{ width: "100%", height: "100%", objectFit: "cover", opacity: 0.7 }} />}
                <div className="scan-line" />
              </div>
              <p className="mono" style={{ color: "#7DD3C8", marginTop: 16 }}>ANALYZING…</p>
            </div>
          )}

          {scanState === "error" && (
            <div style={{ textAlign: "center", marginTop: 40 }}>
              <p style={{ color: "#D6D9DE", maxWidth: 280, margin: "0 auto 20px" }}>{errorMsg}</p>
              <button className="btn btn-secondary" onClick={resetScan}>Try again</button>
            </div>
          )}

          {scanState === "result" && result && (
            <div>
              <div className="panel" style={{ position: "relative", aspectRatio: "4/3", overflow: "hidden", marginBottom: 16 }}>
                <img src={referencePhoto || imagePreview} alt={`${result.make} ${result.model}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                {referencePhoto && imagePreview && (
                  <div style={{ position: "absolute", bottom: 8, left: 8, width: 64, height: 64, borderRadius: 8, overflow: "hidden", boxShadow: "0 4px 10px rgba(0,0,0,0.5)", border: "2px solid #14161A" }}>
                    <img src={imagePreview} alt="Your spot" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 2 }}>
                <h2 className="plate" style={{ fontSize: 22, textTransform: "uppercase", margin: 0 }}>{result.make} {result.model}</h2>
                <span className={`tier-badge tier-${result.rarityTier}`}>{result.rarityTier}</span>
              </div>
              <p style={{ color: "#71717A", fontSize: 14, marginBottom: 16 }}>{result.yearEstimate} · {result.bodyStyle} · {result.color}</p>

              <div className="panel" style={{ padding: 16, marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ color: "#71717A", fontSize: 14 }}>Estimated value</span>
                  <span className="mono" style={{ color: "#52525B", fontSize: 12 }}>{result.confidence} confidence</span>
                </div>
                <p className="mono" style={{ color: "#E8A33D", fontSize: 24, margin: "4px 0" }}>{fmtMoney(result.estimatedValue)}</p>
                <p style={{ color: "#52525B", fontSize: 12 }}>AI estimate — not a formal appraisal</p>
              </div>

              {result.funFact && (
                <div className="panel" style={{ padding: 12, marginBottom: 16, borderColor: "rgba(70,168,156,0.3)" }}>
                  <p style={{ color: "#B8ECE4", fontSize: 14, margin: 0 }}>{result.funFact}</p>
                </div>
              )}

              <div className="panel" style={{ padding: 16, marginBottom: 20 }}>
                {vinStatus === "verified" ? (
                  <p style={{ color: "#86EFAC", fontSize: 14, margin: 0 }}>✓ Verified via VIN — exact spec applied</p>
                ) : (
                  <>
                    <p style={{ color: "#A1A1AA", fontSize: 14, marginBottom: 8 }}>Have the VIN? Get exact make, model & year.</p>
                    <div style={{ display: "flex", gap: 8 }}>
                      <input type="text" placeholder="17-character VIN" maxLength={17} value={vin} onChange={(e) => setVin(e.target.value)} />
                      <button className="btn btn-secondary" style={{ whiteSpace: "nowrap" }} disabled={vinStatus === "loading"} onClick={handleVinLookup}>
                        {vinStatus === "loading" ? "…" : "Decode"}
                      </button>
                    </div>
                    {vinStatus === "error" && <p style={{ color: "#F19A9A", fontSize: 12, marginTop: 8 }}>Couldn't decode that VIN — double check it.</p>}
                  </>
                )}
              </div>

              <div style={{ display: "flex", gap: 12 }}>
                <button className="btn btn-secondary" style={{ flex: 1 }} onClick={resetScan}>Discard</button>
                <button className="btn btn-primary" style={{ flex: 1 }} onClick={saveCar}>Add to garage</button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === "collection" && (
        <div>
          <div className="panel" style={{ padding: 20, marginBottom: 24 }}>
            <p className="eyebrow" style={{ marginBottom: 10 }}>TOTAL GARAGE VALUE</p>
            <p className="mono" style={{ color: "#E8A33D", fontSize: 32, margin: 0 }}>{fmtMoney(totalValue)}</p>
            <p style={{ color: "#52525B", fontSize: 12, marginTop: 10 }}>{collection.length} {collection.length === 1 ? "car" : "cars"} spotted</p>
          </div>

          {collection.length === 0 ? (
            <p style={{ color: "#71717A", textAlign: "center", marginTop: 40 }}>Your garage is empty. Head to Scan to spot your first car.</p>
          ) : (
            <div className="grid-2">
              {collection.map((car) => (
                <div key={car.id} className="panel" style={{ overflow: "hidden", position: "relative" }}>
                  <div style={{ height: 3 }} className={`dot-${car.rarity_tier}`} />
                  <button
                    onClick={() => deleteCar(car.id)}
                    style={{ position: "absolute", top: 10, right: 8, width: 26, height: 26, borderRadius: "50%", background: "rgba(0,0,0,0.6)", border: "none", color: "#D6D9DE", cursor: "pointer" }}
                  >
                    ✕
                  </button>
                  {car.photo_url && <img src={car.photo_url} alt={`${car.make} ${car.model}`} className="car-photo" />}
                  <div style={{ padding: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 5, marginBottom: 4 }}>
                      <span style={{ width: 6, height: 6, borderRadius: "50%" }} className={`dot-${car.rarity_tier}`} />
                      <span style={{ fontSize: 10, textTransform: "uppercase", color: "#71717A", letterSpacing: 0.5 }}>{car.rarity_tier}</span>
                      {car.verified && <span style={{ marginLeft: "auto", color: "#86EFAC", fontSize: 11 }}>✓</span>}
                    </div>
                    <p className="plate" style={{ fontSize: 16, textTransform: "uppercase", margin: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {car.make} {car.model}
                    </p>
                    <p style={{ color: "#71717A", fontSize: 12, margin: "2px 0" }}>{car.year}</p>
                    <p className="mono" style={{ color: "#E8A33D", fontSize: 14, margin: 0 }}>{fmtMoney(car.value)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="bottom-nav">
        <button className={`nav-btn ${tab === "scan" ? "active" : ""}`} onClick={() => setTab("scan")}>Scan</button>
        <button className={`nav-btn ${tab === "collection" ? "active" : ""}`} onClick={() => setTab("collection")}>Garage</button>
      </div>
    </div>
  );
}
