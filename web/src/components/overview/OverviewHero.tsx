import React from "react";

export interface OverviewHeroProps {
  theme: "light" | "dark";
  onReserveClick: () => void;
}

export function OverviewHero({ theme, onReserveClick }: OverviewHeroProps) {
  const illustrationSrc = `/assets/illustrations/${theme}/hero_chatgpt_terminal_${theme}.png`;

  return (
    <div className="overview-hero-card ui-card">
      {/* Responsive Pure-Vector Waves Gradient Layer (Reference: hero-wave-light / hero-wave-dark) */}
      <svg
        className="overview-hero-wave"
        viewBox="0 0 1200 400"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <defs>
          {/* Dark Theme Wave Gradients */}
          <linearGradient id="waveStroke1Dark" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.15" />
            <stop offset="25%" stopColor="#60a5fa" stopOpacity="0.55" />
            <stop offset="55%" stopColor="#818cf8" stopOpacity="0.5" />
            <stop offset="85%" stopColor="#c084fc" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.12" />
          </linearGradient>

          <linearGradient id="waveStroke2Dark" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#818cf8" stopOpacity="0.12" />
            <stop offset="35%" stopColor="#c084fc" stopOpacity="0.45" />
            <stop offset="70%" stopColor="#38bdf8" stopOpacity="0.48" />
            <stop offset="100%" stopColor="#60a5fa" stopOpacity="0.15" />
          </linearGradient>

          <linearGradient id="waveRibbon1Dark" x1="15%" y1="0%" x2="60%" y2="100%">
            <stop offset="0%" stopColor="#6366f1" stopOpacity="0.16" />
            <stop offset="45%" stopColor="#3b82f6" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#070c18" stopOpacity="0.0" />
          </linearGradient>

          <linearGradient id="waveRibbon2Dark" x1="65%" y1="0%" x2="30%" y2="100%">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity="0.13" />
            <stop offset="45%" stopColor="#0ea5e9" stopOpacity="0.08" />
            <stop offset="100%" stopColor="#070c18" stopOpacity="0.0" />
          </linearGradient>

          {/* Light Theme Wave Gradients */}
          <linearGradient id="waveStroke1Light" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#93c5fd" stopOpacity="0.2" />
            <stop offset="30%" stopColor="#3b82f6" stopOpacity="0.5" />
            <stop offset="65%" stopColor="#6366f1" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.15" />
          </linearGradient>

          <linearGradient id="waveStroke2Light" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#a5b4fc" stopOpacity="0.15" />
            <stop offset="40%" stopColor="#818cf8" stopOpacity="0.4" />
            <stop offset="75%" stopColor="#60a5fa" stopOpacity="0.45" />
            <stop offset="100%" stopColor="#93c5fd" stopOpacity="0.12" />
          </linearGradient>

          <linearGradient id="waveRibbon1Light" x1="15%" y1="0%" x2="60%" y2="100%">
            <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.35" />
            <stop offset="50%" stopColor="#c7d2fe" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
          </linearGradient>

          <linearGradient id="waveRibbon2Light" x1="65%" y1="0%" x2="30%" y2="100%">
            <stop offset="0%" stopColor="#ddd6fe" stopOpacity="0.28" />
            <stop offset="50%" stopColor="#bae6fd" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#ffffff" stopOpacity="0.0" />
          </linearGradient>

          {/* Glow filter for radiant wave crests */}
          <filter id="waveGlowEffect" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Ambient Wave Ribbon 1 */}
        <path
          d="M 0,185 C 240,135 430,290 690,280 C 890,270 1040,180 1200,160 L 1200,400 L 0,400 Z"
          fill={theme === "dark" ? "url(#waveRibbon1Dark)" : "url(#waveRibbon1Light)"}
        />

        {/* Overlapping Wave Ribbon 2 */}
        <path
          d="M 0,265 C 280,290 500,190 760,200 C 960,210 1090,275 1200,290 L 1200,400 L 0,400 Z"
          fill={theme === "dark" ? "url(#waveRibbon2Dark)" : "url(#waveRibbon2Light)"}
        />

        {/* Primary Glowing Wave Crest Line */}
        <path
          d="M 0,185 C 240,135 430,290 690,280 C 890,270 1040,180 1200,160"
          fill="none"
          stroke={theme === "dark" ? "url(#waveStroke1Dark)" : "url(#waveStroke1Light)"}
          strokeWidth={theme === "dark" ? "2.2" : "1.8"}
          filter="url(#waveGlowEffect)"
        />

        {/* Secondary Flowing Wave Crest Line */}
        <path
          d="M 0,265 C 280,290 500,190 760,200 C 960,210 1090,275 1200,290"
          fill="none"
          stroke={theme === "dark" ? "url(#waveStroke2Dark)" : "url(#waveStroke2Light)"}
          strokeWidth={theme === "dark" ? "1.8" : "1.5"}
          filter="url(#waveGlowEffect)"
        />

        {/* Fine Ambient Harmonic Contour */}
        <path
          d="M 0,220 C 220,175 460,325 780,310 C 980,300 1110,225 1200,210"
          fill="none"
          stroke={theme === "dark" ? "rgba(147, 197, 253, 0.35)" : "rgba(96, 165, 250, 0.4)"}
          strokeWidth="1"
          strokeDasharray="5 4"
          opacity={theme === "dark" ? "0.45" : "0.55"}
        />
      </svg>

      {/* Floating Background Illustration (positioned right/top-right, giving full width to text) */}
      <div className="hero-illustration-container" aria-hidden="true">
        <img
          src={illustrationSrc}
          alt="Codex & ChatGPT Ilustração"
          className="hero-illustration-img"
          loading="eager"
        />
      </div>

      {/* Main Content (Spans with priority across card) */}
      <div className="hero-content">
        <div className="hero-text-block">
          <span className="kicker-tag">ACESSO SIMPLES. MAIS PRODUTIVIDADE.</span>
          <h1
            style={{
              fontSize: "32px",
              fontWeight: "800",
              color: "var(--text-primary)",
              lineHeight: "1.2",
              marginBottom: "10px",
              letterSpacing: "-0.02em",
            }}
          >
            Reserve sua sessão
          </h1>
          <p
            style={{
              fontSize: "14px",
              color: "var(--text-secondary)",
              lineHeight: "1.5",
            }}
          >
            Garanta seu horário para usar o ChatGPT e o Codex com total segurança e sem erros. São apenas 3 passos:
          </p>
        </div>

        {/* 3 Steps - Full width horizontal row with generous breathing space */}
        <div className="hero-steps-grid">
          {/* Step 1 */}
          <div className="hero-step-item">
            <div className="hero-step-badge">1</div>
            <div className="hero-step-body">
              <div className="hero-step-title">
                <i className="ph ph-calendar" aria-hidden="true" />
                <span>Escolha um horário</span>
              </div>
              <p className="hero-step-desc">
                Veja os horários disponíveis na agenda da sua turma.
              </p>
            </div>
          </div>

          {/* Step 2 */}
          <div className="hero-step-item">
            <div className="hero-step-badge">2</div>
            <div className="hero-step-body">
              <div className="hero-step-title">
                <i className="ph ph-check-circle" aria-hidden="true" />
                <span>Confirme a reserva</span>
              </div>
              <p className="hero-step-desc">
                Clique no horário e confirme sua sessão.
              </p>
            </div>
          </div>

          {/* Step 3 */}
          <div className="hero-step-item">
            <div className="hero-step-badge">3</div>
            <div className="hero-step-body">
              <div className="hero-step-title">
                <i className="ph ph-terminal-window" aria-hidden="true" />
                <span>No horário, copie seu comando de acesso</span>
              </div>
              <p className="hero-step-desc">
                Acesse o terminal e use o comando gerado.
              </p>
            </div>
          </div>
        </div>

        {/* Action Button */}
        <button
          type="button"
          className="btn btn-primary hero-cta-btn"
          onClick={onReserveClick}
        >
          <i className="ph ph-calendar-plus" style={{ fontSize: "18px" }} aria-hidden="true" />
          <span>Reservar minha sessão agora</span>
          <i className="ph ph-arrow-right" style={{ fontSize: "16px", marginLeft: "4px" }} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
