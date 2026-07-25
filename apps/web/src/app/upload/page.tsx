"use client";
import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { usePrivy, useLogin } from "@privy-io/react-auth";
import { Button } from "@/components/ui/button";
import { useUserKey } from "@/lib/client/useUserKey";

export default function UploadPage() {
  const { ready, authenticated, getAccessToken } = usePrivy();
  const { login } = useLogin();
  const { getKeyHex } = useUserKey();
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const submitting = useRef(false);

  const pickFile = useCallback((f: File | null) => {
    setError(null);
    if (f && !f.name.toLowerCase().endsWith(".gpx")) {
      setError("only .gpx files are supported");
      return;
    }
    setFile(f);
  }, []);

  async function handleUpload() {
    if (submitting.current || !file) return;
    submitting.current = true;
    setUploading(true);
    setError(null);
    try {
      const [keyHex, token] = await Promise.all([getKeyHex(), getAccessToken()]);
      if (!token) throw new Error("session expired, please sign in again");

      const form = new FormData();
      form.set("gpx", file);
      form.set("userKeyHex", keyHex);

      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
        body: form,
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "upload failed");
      // The pipeline runs in the background (encryption, 0G Storage,
      // memory, on-chain anchor, inference — minutes end to end). The run
      // page polls GET /api/runs/:id and renders live step status.
      router.push(`/runs/${body.runId}`);
    } catch (e: any) {
      setError(e.message ?? "something went wrong");
      setUploading(false);
    } finally {
      submitting.current = false;
    }
  }

  return (
    <section className="relative mx-auto grid max-w-[1600px] grid-cols-12 gap-y-16 px-8 pb-32 pt-40 md:px-16">
      <span
        aria-hidden
        className="absolute right-8 top-32 hidden font-sans text-[10px] uppercase tracking-[0.3em] text-ocean lg:block md:right-16"
        style={{ writingMode: "vertical-rl" }}
      >
        0run / Vol. 01 — Upload
      </span>

      <div className="col-span-12 md:col-span-9 md:col-start-2">
        <div className="mb-8 flex items-center gap-4">
          <span aria-hidden className="h-px w-12 bg-navy" />
          <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">New run</span>
        </div>
        <h1 className="font-serif text-5xl leading-[0.9] tracking-tight text-navy md:text-7xl">
          Bring your <em className="italic text-orange">run</em>.
        </h1>
        <p className="mt-6 max-w-xl font-sans text-lg leading-relaxed text-navy">
          Upload a GPX file. It is encrypted on your device key and stored on 0G — your coach
          reads it, remembers it, and reports back.
        </p>
      </div>

      <div className="col-span-12 md:col-span-7 md:col-start-2">
        <label
          htmlFor="gpx-input"
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            pickFile(e.dataTransfer.files?.[0] ?? null);
          }}
          className={`flex min-h-[16rem] cursor-pointer flex-col items-center justify-center gap-4 border border-navy px-8 text-center transition-colors duration-500 ${
            dragOver ? "bg-peach/40" : "bg-transparent"
          }`}
        >
          <input
            ref={inputRef}
            id="gpx-input"
            type="file"
            accept=".gpx"
            className="sr-only"
            onChange={(e) => pickFile(e.target.files?.[0] ?? null)}
          />
          {file ? (
            <>
              <span className="font-serif text-2xl italic text-navy">{file.name}</span>
              <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">
                {(file.size / 1024).toFixed(0)} KB — click or drop to replace
              </span>
            </>
          ) : (
            <>
              <span className="font-serif text-3xl italic text-navy">Drop your GPX here</span>
              <span className="font-sans text-xs uppercase tracking-[0.3em] text-ocean">
                or click to browse
              </span>
            </>
          )}
        </label>

        {error && <p className="mt-4 font-sans text-sm text-orange">{error}</p>}

        <div className="mt-8">
          {ready && !authenticated ? (
            <Button variant="primary" onClick={() => login()}>
              Sign in to continue
            </Button>
          ) : (
            <Button variant="primary" disabled={!ready || !file || uploading} onClick={handleUpload}>
              {uploading ? "Uploading…" : "Upload run"}
            </Button>
          )}
        </div>

        {uploading && (
          <p className="mt-6 max-w-md font-sans text-sm leading-relaxed text-ocean">
            Encrypting and sending to 0G Storage — this is a real transaction on 0G Galileo, it
            can take a little time. You will be redirected once it starts processing.
          </p>
        )}
      </div>
    </section>
  );
}
