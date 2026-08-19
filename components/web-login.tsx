"use client";

import { Eye, EyeOff, LoaderCircle, LockKeyhole, LogIn, UserRound } from "lucide-react";
import Image from "next/image";
import { FormEvent, useState } from "react";
import { appPath } from "@/lib/base-path";

export function WebLogin({ initialName = "", message = "" }: { initialName?: string; message?: string }) {
  const [personName, setPersonName] = useState(initialName);
  const [accessCode, setAccessCode] = useState("");
  const [showCode, setShowCode] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState(message);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!personName.trim() || !accessCode) return;
    setError("");
    setIsSubmitting(true);
    try {
      const response = await fetch(appPath("/api/auth/login/"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ personName, accessCode }),
        cache: "no-store"
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Не удалось войти в рабочее пространство.");
      window.location.replace(appPath("/"));
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось войти в рабочее пространство.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="web-login-page">
      <div className="web-login-orbit orbit-one" aria-hidden />
      <div className="web-login-orbit orbit-two" aria-hidden />
      <section className="web-login-card" aria-labelledby="web-login-title">
        <header className="web-login-brand">
          <span className="web-login-logo"><Image src={appPath("/icon.png")} alt="" width={88} height={88} priority /></span>
          <div><strong>GARMENT BURO</strong><small>PROJECT CONTROL</small></div>
        </header>

        <div className="web-login-copy">
          <p>Персональное рабочее пространство</p>
          <h1 id="web-login-title">Войти в виджет</h1>
          <span>Введите своё имя — задачи, уведомления и рабочий контекст загрузятся именно для вас.</span>
        </div>

        <form className="web-login-form" onSubmit={submit}>
          <label>
            <span>Имя сотрудника</span>
            <div className="web-login-field">
              <UserRound size={19} aria-hidden />
              <input
                name="personName"
                value={personName}
                onChange={(event) => setPersonName(event.target.value)}
                placeholder="Например, Никита"
                autoComplete="username"
                autoCapitalize="words"
                disabled={isSubmitting}
                autoFocus
              />
            </div>
          </label>
          <label>
            <span>Код доступа</span>
            <div className="web-login-field">
              <LockKeyhole size={19} aria-hidden />
              <input
                name="accessCode"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
                type={showCode ? "text" : "password"}
                placeholder="Код рабочего пространства"
                autoComplete="current-password"
                disabled={isSubmitting}
              />
              <button type="button" onClick={() => setShowCode((value) => !value)} aria-label={showCode ? "Скрыть код" : "Показать код"}>
                {showCode ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </label>

          {error ? <p className="web-login-error" role="alert">{error}</p> : null}
          <button className="web-login-submit" type="submit" disabled={isSubmitting || !personName.trim() || !accessCode}>
            {isSubmitting ? <LoaderCircle className="spin" size={19} /> : <LogIn size={19} />}
            <span>{isSubmitting ? "Подключаем данные" : "Войти в пространство"}</span>
          </button>
        </form>

        <footer><i /> Защищённое подключение к данным GARMENT BURO</footer>
      </section>
    </main>
  );
}
